import type { FastifyRequest } from "fastify";

/**
 * Extract a bearer token from the `Sec-WebSocket-Protocol` header.
 *
 * Convention: clients advertise a "kryton-token" marker followed by the
 * token itself as a separate subprotocol entry. Anything else (bare
 * subprotocols, missing marker, marker without a following entry)
 * returns null so the caller can fall back to cookie/session auth.
 *
 * Query-string tokens are deliberately not supported because they leak
 * via access logs, browser history, and proxies.
 */
export function extractWsToken(req: FastifyRequest): string | null {
  const proto = req.headers["sec-websocket-protocol"];
  if (typeof proto !== "string" || proto.length === 0) return null;
  const parts = proto.split(",").map((s) => s.trim());
  const marker = parts.indexOf("kryton-token");
  if (marker === -1) return null;
  const candidate = parts[marker + 1];
  return candidate && candidate.length > 0 ? candidate : null;
}
