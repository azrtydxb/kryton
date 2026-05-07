import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import type { AppConfig } from "../config/index.js";

interface SecurityOptions {
  config: AppConfig;
}

export const securityPlugin = fp<SecurityOptions>(async (app, { config }) => {
  await app.register(helmet, {
    contentSecurityPolicy: false, // relaxed; tightened per-route as needed
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.length === 1 && config.CORS_ORIGINS[0] === "*"
      ? true
      : config.CORS_ORIGINS,
    credentials: true,
  });
}, { name: "security" });
