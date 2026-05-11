import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for schema generation, migrations, and studio.
 *
 * Uses POSTGRES_URL during Phase 1 (Drizzle scaffolded alongside Prisma+SQLite).
 * A later phase will consolidate to DATABASE_URL once the Prisma stack is
 * removed.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgresql://kryton:kryton@localhost:5432/kryton",
  },
  strict: true,
  verbose: true,
});
