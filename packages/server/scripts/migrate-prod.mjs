#!/usr/bin/env node
/**
 * Apply pending Drizzle migrations against POSTGRES_URL.
 *
 * Production entrypoint runs this before booting the server. Uses
 * drizzle-orm's migrator (a runtime dep) so we don't need drizzle-kit
 * in the runtime image.
 *
 * Migrations folder defaults to ./dist/db/migrations (the Dockerfile
 * places them there); override via MIGRATIONS_DIR if running from source.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is required to run migrations.");
  process.exit(1);
}

const migrationsFolder = resolve(
  process.env.MIGRATIONS_DIR ?? "./dist/db/migrations",
);

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

try {
  console.log(`Applying Drizzle migrations from ${migrationsFolder} …`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
