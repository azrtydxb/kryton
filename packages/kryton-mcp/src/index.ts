/**
 * Public entrypoint of `@azrtydxb/kryton-mcp`. The bin script calls
 * `main()`; tests import `createProxy` and helpers directly.
 *
 * The shim is intentionally minimal: it bridges stdio MCP JSON-RPC to
 * Kryton's HTTP `/api/mcp` endpoint with bearer auth and `mcp-session-id`
 * tracking. The upstream Kryton server owns the tool catalogue (it
 * generates it from its OpenAPI spec at boot), so this package never
 * declares or validates tools — every frame is a pass-through.
 */

export { loadConfig, type ShimConfig, type ConfigResult } from "./config.js";
export { createLogger, fatal, type Logger, type LogLevel } from "./logger.js";
export { createProxy, type Proxy, type ProxyConfig, type ProxyDeps } from "./proxy.js";
export { readNdjson } from "./stdin.js";
export { SseDecoder, type SseEvent } from "./sse.js";

import { loadConfig } from "./config.js";
import { createLogger, fatal } from "./logger.js";
import { createProxy } from "./proxy.js";
import { readNdjson } from "./stdin.js";

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
}

/** Boot the shim. Resolves when stdin closes and the upstream session
 *  has been cleanly terminated. Rejects on fatal config errors so the
 *  bin script can `process.exit(1)`. */
export async function main(opts: MainOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const result = loadConfig(env);
  if (!result.ok) {
    fatal(result.error.message);
    throw new Error(result.error.message);
  }
  const config = result.config;
  const logger = createLogger({ enabled: config.debug });
  logger.info("starting", { baseUrl: config.baseUrl });

  const proxy = createProxy(
    { baseUrl: config.baseUrl, token: config.token },
    { logger },
  );

  proxy.startNotifications();

  await new Promise<void>((resolve) => {
    readNdjson(process.stdin, {
      onMessage: (msg) => proxy.forward(msg),
      onParseError: (line, err) => {
        logger.warn("stdin-parse-error", {
          error: err.message,
          line: line.slice(0, 200),
        });
      },
      onEnd: () => {
        logger.info("stdin-closed");
        resolve();
      },
    });
  });

  await proxy.close();
  logger.info("stopped");
}
