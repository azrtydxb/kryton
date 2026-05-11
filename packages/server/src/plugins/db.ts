import fp from "fastify-plugin";
import type pg from "pg";

import { createDbClient, type Db } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

/**
 * Decorates the Fastify instance with a Drizzle (`app.db`) client backed by a
 * pg.Pool.
 *
 * Phase 1 of the Postgres + Drizzle migration: registered alongside the
 * existing Prisma plugin. If `POSTGRES_URL` is not configured (e.g. in the
 * current test suite, which still targets SQLite via Prisma), the plugin
 * skips runtime initialization but the `app.db` type augmentation remains in
 * effect so downstream code can be typed against it. A later phase makes
 * Postgres the only supported data layer and removes this fallback.
 */
export const dbPlugin = fp(async (app) => {
  const url = app.config.POSTGRES_URL;
  if (!url) {
    app.log.warn(
      "POSTGRES_URL not set — Drizzle client not initialised. " +
        "Phase 1 of the Postgres migration tolerates this; later phases will not.",
    );
    return;
  }

  let pool: pg.Pool;
  let db: Db;
  try {
    ({ db, pool } = createDbClient(url));
  } catch (err) {
    app.log.error({ err }, "Failed to construct Drizzle client");
    throw err;
  }

  app.decorate("db", db);
  app.log.info("Drizzle client initialised");

  app.addHook("onClose", async () => {
    await pool.end();
    app.log.info("Drizzle pool closed");
  });
}, { name: "db" });
