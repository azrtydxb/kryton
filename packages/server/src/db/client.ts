import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.js";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

/**
 * Construct a Drizzle client and underlying pg Pool from a Postgres connection
 * string. The Pool is created eagerly but does not establish a TCP connection
 * until the first query, so this is safe to call at boot even before the DB is
 * reachable.
 *
 * Phase 1: this is scaffolding only — the schema barrel is empty by design and
 * no app code uses the returned client yet.
 */
export function createDbClient(url: string): { db: Db; pool: pg.Pool } {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
