import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

let container: StartedPostgreSqlContainer | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// global-setup.ts lives at packages/server/src/test/global-setup.ts
// migrations live at packages/server/src/db/migrations
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "db", "migrations");

/**
 * Vitest global setup: boots a pgvector/pgvector:pg16 container, creates the
 * `vector` extension, runs the Drizzle migrations, and exposes the connection
 * URI via `process.env.TEST_DATABASE_URL` for subsequent test files.
 *
 * Note: this does NOT replace `DATABASE_URL`. The existing test suite still
 * targets Prisma + SQLite via `DATABASE_URL=file:./data/kryton-test.db`. This
 * infrastructure is dormant until tests opt in via `createTestDb()`.
 */
export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("kryton_test")
    .withUsername("kryton")
    .withPassword("kryton")
    .start();

  const url = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = url;

  // Enable pgvector extension and run drizzle migrations.
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
}
