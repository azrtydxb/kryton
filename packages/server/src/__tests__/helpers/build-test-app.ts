import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

/**
 * Build a Fastify app for tests. Uses NODE_ENV=test (no logger noise) and
 * an in-memory or test DATABASE_URL if configured.
 *
 * Tests should call `app.close()` in afterAll to clean up Prisma + WS.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  process.env.NODE_ENV = "test";
  const { loadEnv } = await import("../../config/index.js");
  const config = loadEnv();
  return buildApp({ config });
}
