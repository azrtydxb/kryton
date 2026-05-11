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
 * pg.Pool. Drizzle is Kryton's sole data layer.
 *
 * If `POSTGRES_URL` is not set, the plugin warns and skips initialisation —
 * this is tolerated only for tooling that boots the app without a database
 * (e.g. the OpenAPI dump script). All test entry points and `npm start` must
 * provide it.
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
