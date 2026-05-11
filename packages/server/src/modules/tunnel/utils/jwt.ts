/**
 * Local JWT utilities — decoding + structural sanity checks ONLY.
 *
 * The tunnel server is the sole authority on signature verification (it
 * holds the Ed25519 public key set). Kryton never trusts a JWT just
 * because it's locally well-formed; it presents the JWT during the
 * handshake and the tunnel server accepts or rejects with a typed
 * x-reason header. This module exists purely so the admin UI can
 * surface obvious problems (expired, wrong issuer, malformed) without
 * a round-trip.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §4.3.
 */
import type { TunnelClaims, SanityCheckResult } from "../types.js";

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

/**
 * Decode a base64url segment to a string.
 */
function b64url(seg: string): string {
  const pad = "=".repeat((4 - (seg.length % 4)) % 4);
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

/**
 * Decode header + payload without verifying signature. Throws on
 * structural errors. Used by both the sanity-check helper and the
 * tunnel client (which needs the subdomain/exp claims to label the
 * connection during handshake).
 */
export function decodeJwtUnverified(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("jwt_malformed");
  }
  const header = JSON.parse(b64url(parts[0]));
  const payload = JSON.parse(b64url(parts[1]));
  return { header, payload, signature: parts[2] };
}

/**
 * Run local structural + claim checks on a pasted token. Returns a
 * discriminated result the admin route can branch on directly.
 *
 * Failure codes match the admin-tab UI strings in spec 4c §5.2.
 */
export function sanityCheck(token: string): SanityCheckResult {
  let decoded: DecodedJwt;
  try {
    decoded = decodeJwtUnverified(token);
  } catch {
    return { ok: false, code: "jwt_malformed", message: "Token is not a valid JWT." };
  }

  if (decoded.header.alg !== "EdDSA" || decoded.header.typ !== "JWT") {
    return {
      ok: false,
      code: "jwt_wrong_alg",
      message: "Token uses an unsupported algorithm.",
    };
  }

  const p = decoded.payload;
  const required = ["iss", "sub", "subdomain", "plan", "iat", "exp", "jti"];
  for (const key of required) {
    if (p[key] === undefined || p[key] === null) {
      return {
        ok: false,
        code: "jwt_missing_claim",
        message: `Token is missing required claim: ${key}`,
      };
    }
  }

  if (p.iss !== "https://kryton.ai") {
    return {
      ok: false,
      code: "jwt_wrong_issuer",
      message: "Token was not issued by kryton.ai.",
    };
  }

  const exp = Number(p.exp);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    const expDate = Number.isFinite(exp)
      ? new Date(exp * 1000).toISOString().slice(0, 10)
      : "(unknown)";
    return {
      ok: false,
      code: "jwt_expired",
      message: `Token expired on ${expDate}. Get a fresh one from your dashboard.`,
    };
  }

  if (typeof p.subdomain !== "string" || !SUBDOMAIN_RE.test(p.subdomain)) {
    return {
      ok: false,
      code: "jwt_invalid_subdomain",
      message: "Token contains an invalid subdomain claim.",
    };
  }

  const claims: TunnelClaims = {
    iss: String(p.iss),
    sub: String(p.sub),
    subdomain: String(p.subdomain),
    plan: p.plan as TunnelClaims["plan"],
    iat: Number(p.iat),
    exp,
    jti: String(p.jti),
  };
  return { ok: true, claims };
}

/**
 * Truncate a JWT for display in the admin tab: keep the first 8 chars
 * and the last 6 chars, joined with an ellipsis. Never re-renders the
 * full secret.
 */
export function truncateForDisplay(token: string): string {
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}
