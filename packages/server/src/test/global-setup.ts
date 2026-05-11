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
 * URI via `process.env.TEST_DATABASE_URL` for subsequent test files. The
 * `build-test-app` helper promotes `TEST_DATABASE_URL` to `POSTGRES_URL` so
 * `dbPlugin` initialises against this container.
 *
 * If `TEST_DATABASE_URL` is already set (e.g. CI provides a Postgres service
 * container), reuse that database instead of starting testcontainers. The
 * caller is responsible for ensuring pgvector is installed and migrations are
 * applied — in CI both happen in dedicated workflow steps before tests run.
 */
export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) {
    // Reuse caller-provided database (CI service container). Migrations and
    // pgvector are expected to already be applied.
    return;
  }

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
