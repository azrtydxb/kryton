/**
 * Structured stderr logger. Silent unless KRYTON_DEBUG=1.
 * Format: `[kryton-mcp] level=<level> msg=<msg> key=value …`.
 *
 * Errors always emit a single user-facing line on stderr regardless of
 * debug, via `fatal()` — used by the bin before exit(1).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

function formatCtx(ctx?: Record<string, unknown>): string {
  if (!ctx) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

export function createLogger(opts: {
  enabled: boolean;
  write?: (line: string) => void;
}): Logger {
  const write = opts.write ?? ((line: string) => process.stderr.write(line));
  const emit = (level: LogLevel, msg: string, ctx?: Record<string, unknown>): void => {
    if (!opts.enabled) return;
    write(`[kryton-mcp] level=${level} msg=${JSON.stringify(msg)}${formatCtx(ctx)}\n`);
  };
  return {
    debug: (msg, ctx) => emit("debug", msg, ctx),
    info: (msg, ctx) => emit("info", msg, ctx),
    warn: (msg, ctx) => emit("warn", msg, ctx),
    error: (msg, ctx) => emit("error", msg, ctx),
  };
}

/** Emit a friendly, always-visible error line. Use before exit(1). */
export function fatal(msg: string): void {
  process.stderr.write(`[kryton-mcp] ${msg}\n`);
}
