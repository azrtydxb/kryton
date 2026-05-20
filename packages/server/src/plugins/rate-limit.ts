import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../config/index.js";

interface RateLimitOptions {
  config: AppConfig;
}

export const rateLimitPlugin = fp<RateLimitOptions>(async (app, { config }) => {
  // In development the rate limiter is more friction than protection:
  // hot-reloads, screenshot tooling, and rapid-iteration loops trip it.
  // Production still uses the configured global limit.
  if (config.NODE_ENV !== "production") {
    return;
  }
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });
}, { name: "rate-limit" });

/**
 * Stricter rate-limit preset applied to identity routes (login, signup,
 * password reset). Production-only — the plugin above no-ops in dev, so
 * the per-route preset is effectively unenforced there.
 *
 * 60 / minute / IP balances brute-force protection against small teams
 * behind a single NAT — six members hammering refresh during an outage
 * shouldn't all share a 10 / minute budget.
 */
export const identityRateLimit = { max: 60, timeWindow: "1 minute" } as const;
