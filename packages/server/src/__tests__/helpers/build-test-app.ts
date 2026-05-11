import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

/**
 * Build a Fastify app for tests. Uses NODE_ENV=test (no logger noise).
 *
 * Propagates the testcontainers Postgres URI (provided by the vitest global
 * setup as `TEST_DATABASE_URL`) into `POSTGRES_URL` so `dbPlugin` initialises
 * `app.db` against the test container. Drizzle is the sole data layer.
 *
 * Tests should call `app.close()` in afterAll to clean up the pg pool + WS.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  process.env.NODE_ENV = "test";
  if (process.env.TEST_DATABASE_URL && !process.env.POSTGRES_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  }
  // Disable the semantic embedder by default in tests so the 23 MB MiniLM
  // model isn't downloaded and the background worker doesn't spin. Tests that
  // exercise the embedder construct an EmbedWorker directly with a fake.
  if (!process.env.SEMANTIC_PROVIDER) {
    process.env.SEMANTIC_PROVIDER = "off";
  }
  const { loadEnv } = await import("../../config/index.js");
  const config = loadEnv();
  return buildApp({ config });
}
