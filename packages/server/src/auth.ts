import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

const APP_URL = process.env.APP_URL || "http://localhost:5173";

// Map to pass invite code ID from user.create.before to user.create.after
const pendingInviteCodes = new Map<string, string>(); // email -> inviteCode.id

export const auth = betterAuth({
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
        console.log(`[auth] Password reset requested for ${user.email} but SMTP not configured.`);
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
        console.error("[auth] Failed to send reset email:", err);
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
            const GLOBAL_USER = "__global__";
            const regMode = await prisma.settings.findUnique({
              where: { key_userId: { key: "registration_mode", userId: GLOBAL_USER } },
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

              // Store invite code ID so the after hook can mark it as used
              pendingInviteCodes.set(user.email, invite.id);
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
          // Mark invite code as used (if applicable)
          const inviteCodeId = pendingInviteCodes.get(user.email);
          if (inviteCodeId) {
            pendingInviteCodes.delete(user.email);
            await prisma.inviteCode.update({
              where: { id: inviteCodeId },
              data: { usedById: user.id },
            });
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
