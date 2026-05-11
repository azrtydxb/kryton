import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";

loadDotenv({ path: resolve(import.meta.dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),

  /**
   * Postgres connection string for the Drizzle data layer. Drizzle is the
   * sole data layer after Phase 8 of the Postgres migration (Prisma fully
   * removed). Still optional at schema level — `dbPlugin` validates presence
   * at registration time so test harnesses can short-circuit without it.
   */
  POSTGRES_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().default("http://localhost:3001"),
  APP_URL: z.string().default("http://localhost:5173"),

  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  NOTES_DIR: z.string().default("../../notes"),

  WEBAUTHN_RP_ID: z.string().default("localhost"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  OPENAPI_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s !== "false"),

  // ---------------------------------------------------------------------------
  // Semantic search (Phase A)
  // ---------------------------------------------------------------------------
  // SEMANTIC_PROVIDER controls which embedder backs the worker. "off" disables
  // the worker entirely (no model load, no polling) — used by tests so they
  // don't download the 23 MB MiniLM model.
  SEMANTIC_PROVIDER: z.enum(["pgvector-local", "novamem", "off"]).default("pgvector-local"),
  SEMANTIC_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  SEMANTIC_DIMENSIONS: z.coerce.number().int().positive().default(384),
  SEMANTIC_CHUNK_TOKENS: z.coerce.number().int().positive().default(256),
  SEMANTIC_CHUNK_OVERLAP: z.coerce.number().int().positive().default(32),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return Object.freeze(result.data);
}
