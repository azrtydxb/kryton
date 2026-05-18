/**
 * Render the MCP server entry that we splice into each host's config.
 *
 * Two shapes:
 *   - HTTP   — { type: "http", url: <server>/api/mcp, headers: { Authorization } }
 *   - stdio  — { command: "npx", args: ["-y", "@azrtydxb/kryton-mcp"], env: { KRYTON_URL, KRYTON_TOKEN } }
 *
 * The choice is per-host (see `tools.ts`). Pure function; no I/O.
 */

export const SERVER_KEY = "kryton";

/** Shim package name — frozen contract with WS-M. */
export const SHIM_PACKAGE = "@azrtydxb/kryton-mcp";

export type Transport = "http" | "stdio";

export interface EntryParams {
  /** Server URL, e.g. https://kryton.ai (no trailing slash required). */
  server: string;
  /** Raw kryton_… bearer token. */
  token: string;
  /** Optional pinned shim version, e.g. "0.1.0". Defaults to floating. */
  shimVersion?: string;
}

export function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** Build the HTTP entry. */
export function buildHttpEntry(p: EntryParams): Record<string, unknown> {
  return {
    type: "http",
    url: trimTrailingSlash(p.server) + "/api/mcp",
    headers: { Authorization: `Bearer ${p.token}` },
  };
}

/**
 * Build the stdio entry. Pins `@azrtydxb/kryton-mcp` to `shimVersion`
 * when given so a host can't accidentally pull a future incompatible
 * shim once we ship one. The env-var key defaults to `env` — pass
 * `envKey: "environment"` for OpenCode.
 */
export function buildStdioEntry(
  p: EntryParams,
  opts: { envKey?: "env" | "environment"; typeField?: string } = {},
): Record<string, unknown> {
  const spec = p.shimVersion ? `${SHIM_PACKAGE}@${p.shimVersion}` : SHIM_PACKAGE;
  const envKey = opts.envKey ?? "env";
  const entry: Record<string, unknown> = {
    command: "npx",
    args: ["-y", spec],
    [envKey]: {
      KRYTON_URL: trimTrailingSlash(p.server),
      KRYTON_TOKEN: p.token,
    },
  };
  if (opts.typeField) entry.type = opts.typeField;
  return entry;
}

/** Build whichever entry the transport calls for. */
export function buildEntry(
  transport: Transport,
  p: EntryParams,
  opts: { envKey?: "env" | "environment"; typeField?: string } = {},
): Record<string, unknown> {
  if (transport === "http") return buildHttpEntry(p);
  return buildStdioEntry(p, opts);
}
