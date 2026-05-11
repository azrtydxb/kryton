import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as authSchema from "../../db/schema/auth.js";
import { user as userTable } from "../../db/schema/auth.js";
import { settings as settingsTable } from "../../db/schema/settings.js";
import { inviteCode as inviteCodeTable } from "../../db/schema/sharing.js";
import { createLogger } from "../../lib/logger.js";
import { GLOBAL_USER_ID } from "../../lib/pathUtils.js";

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

/**
 * Construct a Better Auth instance bound to the supplied Drizzle DB.
 *
 * Phase 5.1 of the Postgres + Drizzle migration: the hooks that previously
 * went through Prisma (`user.count`, `settings.findUnique`, `inviteCode.*`)
 * now run against the same Drizzle DB used for the auth adapter.
 */
export function createAuth(db: Db) {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    basePath: "/api/auth",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
    trustedOrigins: [APP_URL, "kryton://"],

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
            from: process.env.SMTP_FROM || `"Kryton" <noreply@${process.env.SMTP_HOST}>`,
            to: user.email,
            subject: "Kryton - Password Reset",
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
        rpName: "Kryton",
        rpID: process.env.WEBAUTHN_RP_ID || "localhost",
        origin: APP_URL,
      }),
      twoFactor({
        issuer: "Kryton",
        totpOptions: {
          period: 30,
          digits: 6,
        },
        backupCodes: {
          amount: 10,
        },
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
            const countRow = await db
              .select({ c: count() })
              .from(userTable);
            const userCount = Number(countRow[0]?.c ?? 0);
            const role = userCount === 0 ? "admin" : "user";

            // Invite code validation for invite-only mode
            if (userCount > 0) {
              const regMode = await db.query.settings.findFirst({
                where: and(
                  eq(settingsTable.key, "registration_mode"),
                  eq(settingsTable.userId, GLOBAL_USER_ID),
                ),
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

                const invite = await db.query.inviteCode.findFirst({
                  where: eq(inviteCodeTable.code, inviteCode),
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
                // with concurrent registrations using the same code. The
                // `usedById IS NULL` predicate guarantees only one concurrent
                // claim wins.
                const claimed = await db
                  .update(inviteCodeTable)
                  .set({ usedById: "pending" })
                  .where(
                    and(
                      eq(inviteCodeTable.id, invite.id),
                      isNull(inviteCodeTable.usedById),
                    ),
                  )
                  .returning({ id: inviteCodeTable.id });
                if (claimed.length === 0) {
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
                await db
                  .update(inviteCodeTable)
                  .set({ usedById: user.id })
                  .where(eq(inviteCodeTable.id, pending.id));
              } catch (err) {
                log.error("Failed to finalize invite code", err);
              }
            }

            // Provision user notes directory (delegated to notes module's service)
            const { provisionUserNotes } = await import(
              "../notes/services/user-notes-dir.service.js"
            );
            const NOTES_DIR = process.env.NOTES_DIR
              ? (await import("path")).resolve(process.env.NOTES_DIR)
              : (await import("path")).resolve(
                  (await import("path")).join(import.meta.dirname, "../../../../notes"),
                );
            await provisionUserNotes(NOTES_DIR, user.id);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
