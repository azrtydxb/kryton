import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import type { AppConfig } from "../config/index.js";

interface SecurityOptions {
  config: AppConfig;
}

export const securityPlugin = fp<SecurityOptions>(async (app, { config }) => {
  await app.register(helmet, {
    // CSP is intentionally not enabled here yet — a follow-up design doc
    // covers the allow-list matrix for Swagger UI, markdown-rendered HTML,
    // and dynamically imported plugin bundles. Tracked separately.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  const isWildcard =
    config.CORS_ORIGINS.length === 1 && config.CORS_ORIGINS[0] === "*";

  if (isWildcard && config.NODE_ENV === "production") {
    // With `origin: true` and `credentials: true`, @fastify/cors reflects
    // the request Origin header back as Access-Control-Allow-Origin —
    // not the literal "*" — so browsers DO honor it and credentialed
    // requests succeed from any origin. That's effectively an open
    // CORS surface, which is almost always a misconfiguration in
    // production. Refuse to boot — operators must supply an explicit
    // CORS_ORIGINS allow-list.
    throw new Error(
      "CORS_ORIGINS='*' is not allowed with credentials in production; " +
        "set CORS_ORIGINS to a comma-separated allow-list.",
    );
  }

  await app.register(cors, {
    origin: isWildcard ? true : config.CORS_ORIGINS,
    // Credentials are required for cookie/session auth in same-origin
    // and explicitly-allowlisted cross-origin deployments.
    credentials: true,
  });
}, { name: "security" });
