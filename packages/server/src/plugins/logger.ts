import type { FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config/index.js";

/**
 * Pino logger options for Fastify. Pretty in dev, JSON in prod, with
 * sensitive fields redacted.
 */
export function loggerOptions(config: AppConfig): FastifyServerOptions["logger"] {
  const isDev = config.NODE_ENV === "development";
  const isTest = config.NODE_ENV === "test";

  if (isTest) {
    return false;
  }

  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.secret",
        "*.apiKey",
      ],
      remove: true,
    },
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
          },
        }
      : {}),
  };
}
