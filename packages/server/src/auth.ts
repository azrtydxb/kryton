import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { createLogger } from "./lib/logger.js";
import { GLOBAL_USER_ID } from "./lib/pathUtils.js";
// Import env.ts to ensure dotenv loads before better-auth reads process.env
import "./lib/env.js";

const log = createLogger("auth");

const APP_URL = process.env.APP_URL || "http://localhost:5173";

// Temporary store to pass invite code ID from before to after hook.
// Uses a TTL Map to prevent memory leaks on registration failure.
const pendingInviteCodes = new Map<string, { id: string; timestamp: number }>();
const PENDING_TTL_MS = 30_000; // 30 seconds

function cleanupPendingInvites(): void {
  const now = Date.now();
  for (const [email, entry] of pendingInviteCodes) {
    if (now - entry.timestamp > PENDING_TTL_MS) {
      pendingInviteCodes.delete(email);
    }
  }
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  basePath: "/api/auth",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  trustedOrigins: [APP_URL],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      const smtpHost = process.env.SMTP_HOST;
      if (!smtpHost) {
        log.info(`Password reset requested for ${user.email} but SMTP not configured.`);
        return;
      }
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"Mnemo" <noreply@${process.env.SMTP_HOST}>`,
          to: user.email,
          subject: "Mnemo - Password Reset",
          text: `You requested a password reset.\n\nClick here to reset your password:\n${url}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${url}">Click here to reset your password</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
        });
      } catch (err) {
        log.error("Failed to send reset email:", err);
      }
    },
  },

  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },

  plugins: [
    passkey({
      rpName: "Mnemo",
      rpID: process.env.WEBAUTHN_RP_ID || "localhost",
      origin: APP_URL,
    }),
  ],

  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        input: false,
      },
      disabled: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 300, // 5 minutes
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          // First user auto-becomes admin
          const userCount = await prisma.user.count();
          const role = userCount === 0 ? "admin" : "user";

          // Invite code validation for invite-only mode
          if (userCount > 0) {
            const regMode = await prisma.settings.findUnique({
              where: { key_userId: { key: "registration_mode", userId: GLOBAL_USER_ID } },
            });

            if (regMode?.value === "invite-only") {
              // Extract invite code from the request body
              let inviteCode: string | undefined;
              if (context?.request) {
                try {
                  const body = (await context.request.clone().json()) as Record<string, unknown>;
                  inviteCode = body?.inviteCode as string | undefined;
                } catch {
                  // Ignore parse errors
                }
              }

              if (!inviteCode) {
                throw new Error("Registration requires an invite code");
              }

              const invite = await prisma.inviteCode.findUnique({
                where: { code: inviteCode },
              });

              if (!invite) {
                throw new Error("Invalid invite code");
              }
              if (invite.usedById) {
                throw new Error("Invite code has already been used");
              }
              if (invite.expiresAt && invite.expiresAt < new Date()) {
                throw new Error("Invite code has expired");
              }

              // Atomically claim the invite code to prevent race conditions
              // with concurrent registrations using the same code
              const claimed = await prisma.inviteCode.updateMany({
                where: { id: invite.id, usedById: null },
                data: { usedById: "pending" },
              });
              if (claimed.count === 0) {
                throw new Error("Invite code has already been used");
              }

              // Store invite code ID so the after hook can set the real userId
              cleanupPendingInvites();
              pendingInviteCodes.set(user.email, { id: invite.id, timestamp: Date.now() });
            }
          }

          return {
            data: {
              ...user,
              role,
            },
          };
        },
        after: async (user) => {
          // Finalize invite code — replace "pending" placeholder with actual userId
          const pending = pendingInviteCodes.get(user.email);
          if (pending) {
            pendingInviteCodes.delete(user.email);
            try {
              await prisma.inviteCode.update({
                where: { id: pending.id },
                data: { usedById: user.id },
              });
            } catch (err) {
              log.error("Failed to finalize invite code", err);
            }
          }

          // Provision user notes directory
          const { provisionUserNotes } = await import("./services/userNotesDir.js");
          const NOTES_DIR = process.env.NOTES_DIR
            ? (await import("path")).resolve(process.env.NOTES_DIR)
            : (await import("path")).resolve((await import("path")).join(import.meta.dirname, "../../notes"));
          await provisionUserNotes(NOTES_DIR, user.id);
        },
      },
    },
  },
});

export type Auth = typeof auth;
