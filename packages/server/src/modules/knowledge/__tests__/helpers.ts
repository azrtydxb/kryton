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
 * Truncate tables touched by knowledge graph/search routes. Call from
 * `beforeEach` for test isolation.
 */
export async function resetKnowledgeTestDb(handle: TestDbHandle): Promise<void> {
  await handle.db.execute(sql`
    TRUNCATE TABLE
      "GraphEdge",
      "SearchIndex",
      "EmbedJob",
      "NoteEmbeddingChunk",
      "NoteShare",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface KnowledgeTestAppOptions {
  user?: AuthUser | null;
  apiKey?: { id: string; scope: string } | null;
  /**
   * Drizzle DB handle. Knowledge module routes read/write `app.db`. Required
   * for any test that exercises the routes against a real DB.
   */
  dbHandle?: TestDbHandle;
  /**
   * Optionally decorate `app.embedderState`. Without this, the SearchService
   * `enqueueEmbedJob` short-circuit reads `undefined` (treated as not "off"),
   * so jobs ARE written. Pass `"off"` to verify the no-op path, or
   * `"pgvector-local"` to verify jobs land without the real worker running.
   */
  embedderProvider?: "off" | "pgvector-local" | "novamem";
}

/**
 * Build a Fastify app for knowledge tests. Decorates `app.db` with a real
 * Drizzle handle and stubs `app.auth` so routes can be exercised without a
 * real Better Auth session.
 */
export async function buildKnowledgeTestApp(
  opts: KnowledgeTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  if (opts.dbHandle) {
    app.decorate("db", opts.dbHandle.db);
  }

  if (opts.embedderProvider) {
    app.decorate("embedderState", {
      ready: false,
      provider: opts.embedderProvider,
      dimensions: 384,
    });
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
