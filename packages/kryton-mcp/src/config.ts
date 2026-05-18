/**
 * Environment-variable parsing for the shim. The published surface
 * (`KRYTON_URL` / `KRYTON_TOKEN` / `KRYTON_DEBUG`) is frozen by the
 * krytonctl plan and consumed by `@azrtydxb/kryton-init` when it
 * renders host configs — don't rename without a contract bump.
 */

export interface ShimConfig {
  /** Base URL of the Kryton server. Always normalised without a trailing slash. */
  baseUrl: string;
  /** Bearer token (must begin with `kryton_`). */
  token: string;
  /** When true, the logger emits structured lines on stderr. */
  debug: boolean;
}

export interface ConfigError {
  kind: "missing-token" | "invalid-token" | "invalid-url";
  message: string;
}

export type ConfigResult =
  | { ok: true; config: ShimConfig }
  | { ok: false; error: ConfigError };

const DEFAULT_URL = "https://kryton.ai";

export function loadConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const rawUrl = env.KRYTON_URL?.trim() ?? "";
  const baseUrl = rawUrl.length > 0 ? rawUrl.replace(/\/+$/, "") : DEFAULT_URL;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: {
        kind: "invalid-url",
        message: `KRYTON_URL is not a valid URL: ${rawUrl}`,
      },
    };
  }

  const token = env.KRYTON_TOKEN?.trim() ?? "";
  if (token.length === 0) {
    return {
      ok: false,
      error: {
        kind: "missing-token",
        message:
          "KRYTON_TOKEN is required. Mint one with `npx @azrtydxb/kryton-init` " +
          "or via the API-keys page in the Kryton web UI.",
      },
    };
  }
  if (!token.startsWith("kryton_")) {
    return {
      ok: false,
      error: {
        kind: "invalid-token",
        message:
          "KRYTON_TOKEN must begin with `kryton_`. Did you paste a session " +
          "cookie instead of an API key?",
      },
    };
  }

  const debug = env.KRYTON_DEBUG === "1" || env.KRYTON_DEBUG === "true";
  return { ok: true, config: { baseUrl, token, debug } };
}
