import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { identityModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import { user as userTable } from "../../../db/schema/auth.js";

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
 * the testcontainers Postgres started by the vitest global setup; under
 * fileParallelism: true rows are scoped via per-suite unique userIds (see
 * `createIdentityTestUser`) rather than truncated between tests.
 */
export function createIdentityTestDb(): TestDbHandle {
  return createTestDb();
}

/**
 * Build a per-suite unique test user. The id satisfies SAFE_USER_ID_REGEX in
 * services/user-notes-dir.service.ts (`/^[a-zA-Z0-9_-]{8,64}$/`), and the
 * random suffix + pid keeps two parallel suites from colliding on a single
 * shared Postgres database under fileParallelism: true.
 */
export function createIdentityTestUser(tag: string = "id"): AuthUser {
  const rand = Math.floor(Math.random() * 1e9);
  return {
    id: `u-${tag}-${rand}-${process.pid}`,
    email: `${tag}-${rand}-${process.pid}@test.local`,
    name: tag,
    role: "user",
  };
}

/**
 * Seed the User row for a suite. Call once from `beforeAll`. With per-suite
 * unique ids there's no expected conflict — we deliberately don't use
 * ON CONFLICT DO NOTHING so any ID collision surfaces as a failure instead
 * of silently overlapping with another suite's data.
 */
export async function seedIdentityTestUser(
  handle: TestDbHandle,
  user: AuthUser,
): Promise<void> {
  await handle.db.insert(userTable).values({
    id: user.id,
    name: user.name,
    email: user.email,
  });
}

/**
 * Delete a suite's user. FK cascade handles dependent rows (Session,
 * Account, ApiKey, Passkey, TwoFactor, Settings, McpSession). Call from
 * `afterAll`.
 */
export async function cleanupIdentityTestUser(
  handle: TestDbHandle,
  userId: string,
): Promise<void> {
  await handle.db.delete(userTable).where(eq(userTable.id, userId));
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
