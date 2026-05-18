/**
 * NDJSON reader over a Readable stream. MCP stdio framing is one
 * JSON-RPC message per line. We tolerate `\r\n` and skip blank lines.
 */

import type { Readable } from "node:stream";

export interface NdjsonOptions {
  /** Called once per parsed JSON value. */
  onMessage: (value: unknown) => void | Promise<void>;
  /** Called for lines that fail to parse — non-fatal. */
  onParseError?: (line: string, err: Error) => void;
  /** Called when the stream ends. */
  onEnd?: () => void;
}

export function readNdjson(input: Readable, opts: NdjsonOptions): void {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;
      try {
        const value = JSON.parse(line) as unknown;
        void Promise.resolve(opts.onMessage(value)).catch((err: unknown) => {
          opts.onParseError?.(line, err as Error);
        });
      } catch (err) {
        opts.onParseError?.(line, err as Error);
      }
    }
  });
  input.on("end", () => {
    if (buffer.trim().length > 0) {
      try {
        const value = JSON.parse(buffer) as unknown;
        void Promise.resolve(opts.onMessage(value)).catch(() => {
          /* ignore */
        });
      } catch (err) {
        opts.onParseError?.(buffer, err as Error);
      }
      buffer = "";
    }
    opts.onEnd?.();
  });
}
