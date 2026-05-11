import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "../db/schema/index.js";

const { Pool } = pg;

export type TestDb = NodePgDatabase<typeof schema>;

/**
 * Sentinel error used to force a Drizzle transaction to roll back without
 * surfacing as a real failure to the caller. `withTransaction` swallows this
 * specific error after rollback completes.
 */
class RollbackError extends Error {
  constructor() {
    super("__rollback__");
    this.name = "RollbackError";
  }
}

export interface TestDbHandle {
  db: TestDb;
  pool: pg.Pool;
  /**
   * Runs `fn` inside a Drizzle transaction that is ALWAYS rolled back when
   * `fn` returns (success or failure). Use this for test isolation: each test
   * sees a clean slate without truncating tables.
   */
  withTransaction: <T>(fn: (tx: TestDb) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle test handle backed by the testcontainers-managed Postgres
 * instance. Requires `process.env.TEST_DATABASE_URL` to be set by the vitest
 * global setup (`src/test/global-setup.ts`).
 */
export function createTestDb(): TestDbHandle {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. The vitest global setup at " +
        "src/test/global-setup.ts must run before createTestDb() is called.",
    );
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  const withTransaction = async <T>(fn: (tx: TestDb) => Promise<T>): Promise<T> => {
    let result: T;
    try {
      await db.transaction(async (tx) => {
        result = await fn(tx as TestDb);
        throw new RollbackError();
      });
      // Unreachable: transaction always throws RollbackError above.
      return result!;
    } catch (err) {
      if (err instanceof RollbackError) {
        return result!;
      }
      throw err;
    }
  };

  const close = async () => {
    await pool.end();
  };

  return { db, pool, withTransaction, close };
}
