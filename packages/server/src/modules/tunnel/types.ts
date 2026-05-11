/**
 * Public types for the tunnel module.
 *
 * Mirrors the umbrella spec's JWT claims and the 4c spec's TunnelStatus
 * discriminated union. Kept in one place so admin routes, services,
 * UI types (via @azrtydxb/sdk), and tests all agree.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §2.7.
 */
import { z } from "zod";

/**
 * Decoded JWT claims (per umbrella §5.1). Subset relevant to Kryton's side;
 * Kryton never verifies the signature — the tunnel server does.
 */
export interface TunnelClaims {
  iss: string;
  sub: string;
  subdomain: string;
  plan: "trialing" | "active" | "past_due" | "canceling_at_period";
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Discriminated union for the live state of the tunnel client.
 */
export const tunnelStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle"), message: z.string() }),
  z.object({ state: z.literal("connecting") }),
  z.object({
    state: z.literal("open"),
    subdomain: z.string(),
    sessionId: z.string(),
    connectedAt: z.number().int(),
    tokenExpiresAt: z.number().int(),
  }),
  z.object({
    state: z.literal("backoff"),
    nextAttemptAt: z.number().int(),
    lastError: z.string(),
  }),
  z.object({
    state: z.literal("fatal"),
    reason: z.enum([
      "invalid-jwt",
      "revoked-jwt",
      "subscription-inactive",
      "duplicate-instance",
      "unknown",
    ]),
    message: z.string(),
  }),
  z.object({ state: z.literal("closing") }),
]);

export type TunnelStatus = z.infer<typeof tunnelStatusSchema>;

/**
 * Body for POST /api/admin/tunnel/token. JWT structural regex (three
 * base64url segments separated by dots). Server validates further via
 * sanityCheck before persisting.
 */
export const setTokenSchema = z.object({
  token: z
    .string()
    .regex(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});

export const statsQuerySchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const tunnelStatsSchema = z.object({
  window: z.enum(["24h", "7d", "30d"]),
  requests: z.number().int().nonnegative(),
  bytes_in: z.number().int().nonnegative(),
  bytes_out: z.number().int().nonnegative(),
  daily: z.array(
    z.object({
      date: z.string(),
      requests: z.number().int().nonnegative(),
      bytes_in: z.number().int().nonnegative(),
      bytes_out: z.number().int().nonnegative(),
    }),
  ),
  since: z.number().int(),
});

export type TunnelStats = z.infer<typeof tunnelStatsSchema>;

/**
 * Sanity-check result for a freshly pasted JWT (no signature verify).
 */
export type SanityCheckResult =
  | { ok: true; claims: TunnelClaims }
  | {
      ok: false;
      code:
        | "jwt_malformed"
        | "jwt_wrong_alg"
        | "jwt_wrong_issuer"
        | "jwt_expired"
        | "jwt_missing_claim"
        | "jwt_invalid_subdomain";
      message: string;
    };
