#!/usr/bin/env node
/**
 * `kryton-mcp` bin entrypoint. Validates env via `loadConfig` (delegated
 * inside `main()`), then runs the stdio↔HTTP proxy until stdin closes.
 *
 * Exit codes:
 *   0  clean shutdown
 *   1  config error or fatal proxy error
 */

import { main } from "./index.js";

main().then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    // `main()` has already emitted a friendly stderr line for known
    // failure modes (missing token, bad URL). For anything else, surface
    // the message so the host's MCP log shows something actionable.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg && !msg.startsWith("KRYTON_")) {
      process.stderr.write(`[kryton-mcp] ${msg}\n`);
    }
    process.exit(1);
  },
);
