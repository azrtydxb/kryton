import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { agentsRoutes } from "../routes/agents.routes.js";
import { AgentService } from "../services/agent.service.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";

export interface AgentsTestAppOptions {
  /** The user returned by auth helpers. Set to null to simulate anonymous. */
  user?: AuthUser | null;
  /** Handle returned by `createAgentsTestDb()` (shared across the test file). */
  dbHandle: TestDbHandle;
}

/**
 * Shared Drizzle test DB handle. Agents tests share a single connection to
 * the testcontainers Postgres started by the vitest global setup; rows are
 * cleared between tests via `resetAgentsTestDb()` instead of opening a new
 * pool per app.
 */
export function createAgentsTestDb(): TestDbHandle {
  return createTestDb();
}

/**
 * Truncate all tables touched by the agents tests. Call from `beforeEach`
 * (or `afterEach`) to keep tests isolated.
 */
export async function resetAgentsTestDb(handle: TestDbHandle): Promise<void> {
  // RESTART IDENTITY + CASCADE so dependent FKs (AgentToken -> Agent -> User)
  // clear in one shot.
  await handle.db.execute(sql`
    TRUNCATE TABLE
      "AgentToken",
      "Agent",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Build a Fastify app for agents tests. Decorates `app.db` with the shared
 * Drizzle testcontainers handle and stubs out `app.auth` so we don't need
 * real Better Auth sessions.
 */
export async function buildAgentsTestApp(
  opts: AgentsTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  app.decorate("db", opts.dbHandle.db);

  const user = opts.user ?? null;
  const ctx: AuthContext | null = user
    ? { user, apiKey: null, agentId: null }
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

  const agentService = new AgentService(app);
  await app.register(agentsRoutes({ agentService }), { prefix: "/api/agents" });

  await app.ready();
  return app;
}
