import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";
import { withMeta } from "./meta.js";

loadDotenv({ path: resolve(import.meta.dirname, "../../.env") });

// Per-field metadata (secret / userFacing / description) is attached via the
// `withMeta` helper. Runtime parsing is unchanged — `withMeta` returns the
// same Zod schema. The metadata is consumed by
// `scripts/dump-config-schema.ts` to emit `config-schema.json`, the single
// source of truth for compose / helm / operator deployment surfaces.
//
// Audit decisions (A3):
//   - All credentials / tokens / signing-keys are `secret: true`.
//   - All OAuth client secrets and SMTP creds are `secret: true`.
//   - OAuth *client IDs* and SMTP host/port/from are `secret: false` —
//     they're public identifiers, not sensitive.
//   - Internal operational knobs (LOG_LEVEL, OPENAPI_ENABLED, NOTES_DIR,
//     SEMANTIC_* tuning) are `userFacing: false` — sensible defaults, not
//     surfaced in helm values.yaml top-level.
//   - User-tunable knobs (NODE_ENV, PORT, HOST, *_URL, CORS, RATE_LIMIT,
//     WEBAUTHN_RP_ID, OAuth IDs, SMTP block) are `userFacing: true`.

const envSchema = z.object({
  NODE_ENV: withMeta(
    z.enum(["development", "test", "production"]).default("development"),
    { secret: false, userFacing: true, description: "Runtime environment." },
  ),
  LOG_LEVEL: withMeta(
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    {
      secret: false,
      userFacing: false,
      description: "Pino log level for the server.",
    },
  ),
  PORT: withMeta(z.coerce.number().int().positive().default(3001), {
    secret: false,
    userFacing: true,
    description: "TCP port the HTTP server listens on.",
  }),
  HOST: withMeta(z.string().default("0.0.0.0"), {
    secret: false,
    userFacing: true,
    description: "Interface the HTTP server binds to.",
  }),

  /**
   * Postgres connection string for the Drizzle data layer. Drizzle is the
   * sole data layer after Phase 8 of the Postgres migration (Prisma fully
   * removed). Still optional at schema level — `dbPlugin` validates presence
   * at registration time so test harnesses can short-circuit without it.
   */
  POSTGRES_URL: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "Postgres connection string for the Drizzle data layer.",
  }),

  BETTER_AUTH_SECRET: withMeta(
    z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    {
      secret: true,
      userFacing: true,
      description: "Signing secret for Better-Auth sessions (min 32 chars).",
    },
  ),
  BETTER_AUTH_URL: withMeta(z.string().default("http://localhost:3001"), {
    secret: false,
    userFacing: true,
    description: "Public URL the server is reachable at for Better-Auth.",
  }),
  APP_URL: withMeta(z.string().default("http://localhost:5173"), {
    secret: false,
    userFacing: true,
    description: "Public URL of the client app (used for redirects / CORS).",
  }),

  CORS_ORIGINS: withMeta(
    z
      .string()
      .default("http://localhost:5173")
      .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
    {
      secret: false,
      userFacing: true,
      description: "Comma-separated list of allowed CORS origins.",
    },
  ),

  RATE_LIMIT_MAX: withMeta(z.coerce.number().int().positive().default(1000), {
    secret: false,
    userFacing: true,
    description: "Max requests per rate-limit window per client.",
  }),
  RATE_LIMIT_WINDOW: withMeta(z.string().default("1 minute"), {
    secret: false,
    userFacing: true,
    description: "Rate-limit window (e.g. \"1 minute\").",
  }),

  NOTES_DIR: withMeta(z.string().default("../../notes"), {
    secret: false,
    userFacing: false,
    description: "Filesystem path for note storage.",
  }),

  WEBAUTHN_RP_ID: withMeta(z.string().default("localhost"), {
    secret: false,
    userFacing: true,
    description: "WebAuthn Relying Party ID (typically the public hostname).",
  }),

  GOOGLE_CLIENT_ID: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "Google OAuth client ID (public identifier).",
  }),
  GOOGLE_CLIENT_SECRET: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "Google OAuth client secret.",
  }),
  GITHUB_CLIENT_ID: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "GitHub OAuth client ID (public identifier).",
  }),
  GITHUB_CLIENT_SECRET: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "GitHub OAuth client secret.",
  }),

  SMTP_HOST: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "SMTP server hostname for outbound mail.",
  }),
  SMTP_PORT: withMeta(z.coerce.number().optional(), {
    secret: false,
    userFacing: true,
    description: "SMTP server port.",
  }),
  SMTP_SECURE: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "Whether to use TLS for SMTP (\"true\"/\"false\").",
  }),
  SMTP_USER: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "SMTP auth username.",
  }),
  SMTP_PASS: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "SMTP auth password.",
  }),
  SMTP_FROM: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "Default From: address for outbound mail.",
  }),

  // ---------------------------------------------------------------------------
  // APNs (Apple Push Notification service)
  // ---------------------------------------------------------------------------
  APNS_KEY_ID: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "APNs token-auth key ID (10-char, from Apple Developer portal).",
  }),
  APNS_TEAM_ID: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "Apple Developer Team ID used for APNs token auth.",
  }),
  APNS_BUNDLE_ID: withMeta(z.string().optional(), {
    secret: false,
    userFacing: true,
    description: "iOS app bundle identifier for APNs topic (e.g. com.kryton.mobile).",
  }),
  APNS_KEY_PATH: withMeta(z.string().optional(), {
    secret: true,
    userFacing: true,
    description: "Filesystem path to the APNs .p8 private key file.",
  }),
  APNS_PRODUCTION: withMeta(
    z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    {
      secret: false,
      userFacing: true,
      description: "Send APNs to production gateway (\"true\") or sandbox (\"false\").",
    },
  ),

  OPENAPI_ENABLED: withMeta(
    z
      .string()
      .default("true")
      .transform((s) => s !== "false"),
    {
      secret: false,
      userFacing: false,
      description: "Enable the /docs OpenAPI UI (\"true\"/\"false\").",
    },
  ),

  // ---------------------------------------------------------------------------
  // Semantic search (Phase A)
  // ---------------------------------------------------------------------------
  // SEMANTIC_PROVIDER controls which embedder backs the worker. "off" disables
  // the worker entirely (no model load, no polling) — used by tests so they
  // don't download the 23 MB MiniLM model.
  SEMANTIC_PROVIDER: withMeta(
    z.enum(["pgvector-local", "novamem", "off"]).default("pgvector-local"),
    {
      secret: false,
      userFacing: true,
      description: "Semantic-search embedder backend (\"off\" disables).",
    },
  ),
  SEMANTIC_MODEL: withMeta(z.string().default("Xenova/all-MiniLM-L6-v2"), {
    secret: false,
    userFacing: false,
    description: "HuggingFace model id for the local embedder.",
  }),
  SEMANTIC_DIMENSIONS: withMeta(z.coerce.number().int().positive().default(384), {
    secret: false,
    userFacing: false,
    description: "Embedding vector dimensions (must match the model).",
  }),
  SEMANTIC_CHUNK_TOKENS: withMeta(z.coerce.number().int().positive().default(256), {
    secret: false,
    userFacing: false,
    description: "Tokens per semantic-search chunk.",
  }),
  SEMANTIC_CHUNK_OVERLAP: withMeta(z.coerce.number().int().positive().default(32), {
    secret: false,
    userFacing: false,
    description: "Token overlap between adjacent chunks.",
  }),
});

export { envSchema };
export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return Object.freeze(result.data);
}
