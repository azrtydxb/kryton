import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../config/index.js";

interface RateLimitOptions {
  config: AppConfig;
}

export const rateLimitPlugin = fp<RateLimitOptions>(async (app, { config }) => {
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });
}, { name: "rate-limit" });

/** Stricter rate limit preset for identity routes (login, signup, reset). */
export const identityRateLimit = { max: 10, timeWindow: "1 minute" } as const;
