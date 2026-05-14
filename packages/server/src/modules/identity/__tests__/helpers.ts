import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { identityModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";

export interface IdentityTestAppOptions {
  /** The user returned by auth helpers. Set to null to simulate anonymous. */
  user?: AuthUser | null;
  /** Whether the simulated session is API-key based. */
  apiKey?: { id: string; scope: string } | null;
  /** Handle returned by `createIdentityTestDb()` (shared across the test file). */
  dbHandle: TestDbHandle;
}

/**
 * Shared Drizzle test DB handle. Identity tests share a single connection to
 * the testcontainers Postgres started by the vitest global setup; rows are
 * cleared between tests via `resetIdentityTestDb()` instead of opening a
 * new pool per app.
 */
export function createIdentityTestDb(): TestDbHandle {
  return createTestDb();
}

/**
 * Truncate all tables touched by the identity tests. Call from `beforeEach`
 * (or `afterEach`) to keep tests isolated.
 */
export async function resetIdentityTestDb(handle: TestDbHandle): Promise<void> {
  // RESTART IDENTITY + CASCADE so dependent FKs (Session, ApiKey, ...) clear
  // in one shot. Only the tables identity routes/services touch are listed,
  // but CASCADE handles any rows in unrelated tables that reference them.
  await handle.db.execute(sql`
    TRUNCATE TABLE
      "ApiKey",
      "Session",
      "Account",
      "Passkey",
      "TwoFactor",
      "InviteCode",
      "Settings",
      "McpSession",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Build a Fastify app for identity tests. Decorates `app.db` with the shared
 * Drizzle testcontainers handle and stubs out `app.auth` so we don't need
 * real Better Auth sessions.
 */
export async function buildIdentityTestApp(
  opts: IdentityTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  app.decorate("db", opts.dbHandle.db);

  const user = opts.user ?? null;
  const apiKey = opts.apiKey ?? null;
  const ctx: AuthContext | null = user
    ? { user, apiKey, agentId: null }
    : null;

  const authApi: AuthApi = {
    instance: {} as never,
    async resolve() {
      return ctx;
    },
    async requireUser() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx.user;
    },
    async requireAuth() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx;
    },
    async getOptionalUser() {
      return ctx?.user ?? null;
    },
    async requireAdmin() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      if (ctx.user.role !== "admin") {
        throw new ForbiddenError("Admin access required");
      }
      return ctx.user;
    },
    requireWriteScope(c) {
      if (!c.apiKey) return;
      if (c.apiKey.scope === "read-write") return;
      throw new ForbiddenError("Insufficient API key scope — read-write access required");
    },
    requireSession(c) {
      if (c.apiKey) {
        throw new ForbiddenError("This endpoint requires browser session authentication");
      }
    },
    async authenticateWsToken() {
      return null;
    },
  };
  app.decorate("auth", authApi);

  await app.register(errorsPlugin);
  await app.register(identityModule);

  await app.ready();
  return app;
}
