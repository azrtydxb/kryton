/**
 * BetterAuth sign-in + API-key mint against a Kryton server.
 *
 *   POST /api/auth/sign-in/email  → session cookie (Set-Cookie)
 *   POST /api/api-keys            → { id, key: "kryton_…" }   (once)
 *   DELETE /api/api-keys/:id      → revoke on uninstall
 *
 * Pure native fetch — no SDK dependency.
 */

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

export interface ProbeOpts {
  server: string;
  fetchImpl?: typeof fetch;
}

export interface SignInOpts {
  server: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export interface MintOpts {
  server: string;
  sessionCookie: string;
  name: string;
  fetchImpl?: typeof fetch;
}

export interface RevokeOpts {
  server: string;
  sessionCookie: string;
  apiKeyId: string;
  fetchImpl?: typeof fetch;
}

export interface MintedKey {
  id: string;
  /** Plaintext kryton_… bearer; only returned once by the server. */
  key: string;
  /** First 16 chars of the plaintext, for display + state-file. */
  prefix: string;
}

export function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** GET /health (or fallback) — throws AuthError if unreachable / non-2xx. */
export async function probeHealth(opts: ProbeOpts): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = trimTrailingSlash(opts.server) + "/health";
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new AuthError(
      `cannot reach ${url} — is the server running? (${(e as Error).message})`,
      0,
    );
  }
  if (!res.ok) {
    throw new AuthError(`health check failed: ${res.status} ${res.statusText}`, res.status);
  }
}

/**
 * BetterAuth email sign-in. Returns the raw session cookie pair
 * (`name=value`) to forward as `Cookie:` on subsequent requests.
 */
export async function signIn(opts: SignInOpts): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = trimTrailingSlash(opts.server);
  const url = origin + "/api/auth/sign-in/email";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
    redirect: "manual",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AuthError(
      `sign-in failed: ${res.status} ${res.statusText}${formatBodyError(body)}`,
      res.status,
    );
  }
  const cookie = extractSessionCookie(res);
  if (!cookie) {
    throw new AuthError("sign-in succeeded but no session cookie was returned", 0);
  }
  return cookie;
}

/**
 * Mint an API key. The server returns `{id, key}` once — `key` is the
 * plaintext bearer with the `kryton_` prefix. We never see it again.
 */
export async function mintApiKey(opts: MintOpts): Promise<MintedKey> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = trimTrailingSlash(opts.server);
  const url = origin + "/api/api-keys";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: opts.sessionCookie,
      origin,
    },
    body: JSON.stringify({ name: opts.name }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AuthError(
      `api-key mint failed: ${res.status} ${res.statusText}${formatBodyError(body)}`,
      res.status,
    );
  }
  const json = (await res.json()) as { id?: unknown; key?: unknown };
  if (typeof json.id !== "string" || typeof json.key !== "string") {
    throw new AuthError("api-key mint response missing id or key", 0);
  }
  return { id: json.id, key: json.key, prefix: json.key.slice(0, 16) };
}

/** DELETE /api/api-keys/:id — revoke. Tolerates 404 (already gone). */
export async function revokeApiKey(opts: RevokeOpts): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = trimTrailingSlash(opts.server);
  const url = `${origin}/api/api-keys/${encodeURIComponent(opts.apiKeyId)}`;
  const res = await fetchImpl(url, {
    method: "DELETE",
    headers: { cookie: opts.sessionCookie, origin },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AuthError(
      `api-key revoke failed: ${res.status} ${res.statusText}${formatBodyError(body)}`,
      res.status,
    );
  }
}

// ─── Internal cookie + body helpers ───────────────────────────────────

export function extractSessionCookie(res: Response): string | null {
  const fromGetSetCookie =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : null;
  const candidates = fromGetSetCookie ?? splitSetCookie(res.headers.get("set-cookie"));
  for (const directive of candidates) {
    const pair = directive.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (
      name === "session_token" ||
      name.endsWith(".session_token") ||
      name.startsWith("better-auth.") ||
      name === "kryton.session_token"
    ) {
      return pair;
    }
  }
  return null;
}

function splitSetCookie(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/,(?=[^,]+=)/g).map((s) => s.trim());
}

export function formatBodyError(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const err = parsed?.error ?? parsed?.message;
    if (typeof err === "string" && err.length > 0) {
      return ` — ${err.slice(0, 120)}`;
    }
  } catch {
    /* not JSON; fall through */
  }
  return "";
}
