import { describe, it, expect } from "vitest";
import {
  decodeJwtUnverified,
  sanityCheck,
  truncateForDisplay,
} from "../utils/jwt.js";

/**
 * Forge a JWT-shaped string with the given payload. Signature is bogus —
 * sanityCheck doesn't verify it. We just need the structural form.
 */
function fakeJwt(payload: Record<string, unknown>, header: Record<string, unknown> = {
  alg: "EdDSA",
  typ: "JWT",
  kid: "v1",
}): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64(header)}.${b64(payload)}.${"A".repeat(86)}`;
}

const validPayload = () => ({
  iss: "https://kryton.ai",
  sub: "tenant_1",
  subdomain: "xyz",
  plan: "active" as const,
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + 86400,
  jti: "tok_abc123",
});

describe("decodeJwtUnverified", () => {
  it("decodes a well-formed JWT", () => {
    const token = fakeJwt(validPayload());
    const decoded = decodeJwtUnverified(token);
    expect(decoded.header.alg).toBe("EdDSA");
    expect(decoded.payload.subdomain).toBe("xyz");
  });

  it("throws on a malformed JWT", () => {
    expect(() => decodeJwtUnverified("not-a-jwt")).toThrow();
    expect(() => decodeJwtUnverified("only.two")).toThrow();
  });
});

describe("sanityCheck", () => {
  it("accepts a valid token", () => {
    const res = sanityCheck(fakeJwt(validPayload()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.subdomain).toBe("xyz");
      expect(res.claims.jti).toBe("tok_abc123");
    }
  });

  it("rejects malformed token", () => {
    const res = sanityCheck("nope");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_malformed");
  });

  it("rejects wrong alg", () => {
    const token = fakeJwt(validPayload(), { alg: "HS256", typ: "JWT", kid: "v1" });
    const res = sanityCheck(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_wrong_alg");
  });

  it("rejects wrong issuer", () => {
    const res = sanityCheck(fakeJwt({ ...validPayload(), iss: "https://evil.example" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_wrong_issuer");
  });

  it("rejects expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const res = sanityCheck(fakeJwt({ ...validPayload(), exp: past }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_expired");
  });

  it("rejects missing claim", () => {
    const p = validPayload() as Record<string, unknown>;
    delete p.subdomain;
    const res = sanityCheck(fakeJwt(p));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_missing_claim");
  });

  it("rejects invalid subdomain shape", () => {
    const res = sanityCheck(fakeJwt({ ...validPayload(), subdomain: "ab" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_invalid_subdomain");
  });

  it("rejects subdomain with bad characters", () => {
    const res = sanityCheck(fakeJwt({ ...validPayload(), subdomain: "BAD.CASE" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("jwt_invalid_subdomain");
  });
});

describe("truncateForDisplay", () => {
  it("returns short tokens unchanged", () => {
    expect(truncateForDisplay("abc")).toBe("abc");
    expect(truncateForDisplay("0123456789abcdef")).toBe("0123456789abcdef");
  });

  it("truncates long tokens", () => {
    const token = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4eXoifQ.ABCDEFGHIJ";
    const result = truncateForDisplay(token);
    expect(result.startsWith("eyJhbGci")).toBe(true);
    expect(result.endsWith("GHIJ".slice(-6).padStart(6, "G"))).toBe(false);
    expect(result.endsWith("CDEFGH".slice(-6))).toBe(false);
    expect(result).toContain("…");
    // Last 6 chars of the original token should be the suffix.
    expect(result.slice(-6)).toBe(token.slice(-6));
  });
});
