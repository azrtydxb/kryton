import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

/**
 * Build a Fastify app for tests. Uses NODE_ENV=test (no logger noise) and
 * an in-memory or test DATABASE_URL if configured.
 *
 * Phase 4 of the Postgres + Drizzle migration: the auth plugin now requires
 * a Drizzle DB. We propagate the testcontainers Postgres URI (provided by
 * the vitest global setup as `TEST_DATABASE_URL`) into `POSTGRES_URL` so
 * `dbPlugin` initialises `app.db` and the Better Auth Drizzle adapter has a
 * backing store. The existing SQLite-backed Prisma instance is kept active
 * via `DATABASE_URL`; both data layers coexist until Phase 5.
 *
 * Tests should call `app.close()` in afterAll to clean up Prisma + WS.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  process.env.NODE_ENV = "test";
  if (process.env.TEST_DATABASE_URL && !process.env.POSTGRES_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  }
  const { loadEnv } = await import("../../config/index.js");
  const config = loadEnv();
  return buildApp({ config });
}
