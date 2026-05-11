import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for schema generation, migrations, and studio.
 *
 * Reads connection from POSTGRES_URL (the single DB env var consumed at
 * runtime; DATABASE_URL was retired alongside Prisma in Phase 8).
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      "postgresql://kryton:kryton@localhost:5432/kryton",
  },
  strict: true,
  verbose: true,
});
