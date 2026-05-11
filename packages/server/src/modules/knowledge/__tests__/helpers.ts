import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { knowledgeModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";

/**
 * Shared Drizzle test DB handle for knowledge tests. Mirrors the identity
 * helpers pattern.
 */
export function createKnowledgeTestDb(): TestDbHandle {
  return createTestDb();
}

/**
 * Truncate tables touched by knowledge graph routes/services. Call from
 * `beforeEach` for test isolation.
 */
export async function resetKnowledgeTestDb(handle: TestDbHandle): Promise<void> {
  await handle.db.execute(sql`
    TRUNCATE TABLE
      "GraphEdge",
      "SearchIndex",
      "NoteShare",
      "SyncCursor",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface KnowledgeTestAppOptions {
  user?: AuthUser | null;
  apiKey?: { id: string; scope: string } | null;
  /**
   * Optional prisma stub. Routes that still use Prisma (MiniSearch-backed
   * search index + query, which die in Phase 6) read from this.
   */
  prisma?: unknown;
  /**
   * Optional Drizzle DB handle. Routes migrated to Drizzle (graph) read from
   * this. Provide it when exercising graph routes against a real test DB.
   */
  dbHandle?: TestDbHandle;
}

/**
 * Build a Fastify app for knowledge tests. Stubs `app.prisma` (for MiniSearch-
 * era search code that dies in Phase 6) and/or decorates `app.db` with a real
 * Drizzle handle (for graph routes migrated in Phase 5.5). Also stubs `app.auth`
 * so routes can be exercised without a real Better Auth session.
 */
export async function buildKnowledgeTestApp(
  opts: KnowledgeTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  if (opts.prisma !== undefined) {
    app.decorate("prisma", opts.prisma as never);
  }
  if (opts.dbHandle) {
    app.decorate("db", opts.dbHandle.db);
  }

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
  await app.register(knowledgeModule);

  await app.ready();
  return app;
}
