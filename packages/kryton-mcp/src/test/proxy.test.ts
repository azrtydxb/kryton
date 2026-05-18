/**
 * Round-trip tests for the HTTP proxy. Spins up a tiny in-process
 * `http.createServer` standing in for Kryton's `/api/mcp` endpoint and
 * drives `createProxy` end-to-end:
 *  - initialize → captures `mcp-session-id`
 *  - tools/list → returns dynamic tools (JSON response)
 *  - tools/call → server streams response as SSE (multi-frame)
 *  - 404 on POST → session recovery + retry
 *  - upstream 500 → synthesised JSON-RPC error to stdout
 *  - unreachable upstream → synthesised JSON-RPC error to stdout
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createProxy } from "../proxy.js";
import { createLogger } from "../logger.js";

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
  authHeaders: string[];
  sessionIds: string[];
  posts: { body: unknown; sessionId: string | null }[];
}

interface PostBehaviour {
  /** `auto` (default) responds based on method; `404` short-circuits. */
  mode: "auto" | "404" | "500";
}

interface ServerOpts {
  /** First N POSTs use the override behaviour; subsequent POSTs auto. */
  postOverrides?: PostBehaviour[];
  /** If true, the GET notifications endpoint always 405s (closed). */
  noNotifications?: boolean;
  /** Issue a new session on every initialize. */
  sessionFactory?: () => string;
}

async function startServer(opts: ServerOpts = {}): Promise<ServerHandle> {
  const handle: ServerHandle = {
    url: "",
    close: async () => {
      /* set below */
    },
    authHeaders: [],
    sessionIds: [],
    posts: [],
  };
  let postCount = 0;
  const sessions = new Set<string>();
  const sessionFactory =
    opts.sessionFactory ?? (() => `sess-${Math.random().toString(36).slice(2, 10)}`);

  const server = http.createServer((req, res) => {
    handle.authHeaders.push(String(req.headers.authorization ?? ""));
    if (req.url !== "/api/mcp") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const sid =
      typeof req.headers["mcp-session-id"] === "string"
        ? (req.headers["mcp-session-id"] as string)
        : null;
    handle.sessionIds.push(sid ?? "");

    if (req.method === "DELETE") {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (req.method === "GET") {
      if (opts.noNotifications) {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (!sid || !sessions.has(sid)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(": ping\n\n");
      // Stay open until client aborts.
      req.on("close", () => {
        res.end();
      });
      return;
    }

    if (req.method === "POST") {
      const idx = postCount;
      postCount += 1;
      const override = opts.postOverrides?.[idx];
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: { method?: string; id?: unknown; params?: unknown } = {};
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          /* leave empty */
        }
        handle.posts.push({ body: parsed, sessionId: sid });

        if (override?.mode === "404") {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (override?.mode === "500") {
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain");
          res.end("kaboom");
          return;
        }

        if (parsed.method === "initialize") {
          const newSid = sessionFactory();
          sessions.add(newSid);
          res.statusCode = 200;
          res.setHeader("mcp-session-id", newSid);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "kryton", version: "test" } },
            }),
          );
          return;
        }

        if (!sid || !sessions.has(sid)) {
          res.statusCode = 404;
          res.end();
          return;
        }

        if (parsed.method === "tools/list") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { tools: [{ name: "kryton.notes.list", inputSchema: { type: "object" } }] },
            }),
          );
          return;
        }

        if (parsed.method === "tools/call") {
          res.statusCode = 200;
          res.setHeader("content-type", "text/event-stream");
          res.write("event: message\n");
          res.write(
            `data: ${JSON.stringify({ jsonrpc: "2.0", method: "progress", params: { pct: 50 } })}\n\n`,
          );
          res.write("event: message\n");
          res.write(
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content: [{ type: "text", text: "ok" }] },
            })}\n\n`,
          );
          res.end();
          return;
        }

        // Notifications (no id) → 202.
        res.statusCode = 202;
        res.end();
      });
      return;
    }

    res.statusCode = 405;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  handle.url = `http://127.0.0.1:${addr.port}`;
  handle.close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  return handle;
}

function collectStdout(): { write: (line: string) => void; lines: unknown[] } {
  const lines: unknown[] = [];
  return {
    write: (line: string) => {
      const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
      if (trimmed.length === 0) return;
      lines.push(JSON.parse(trimmed) as unknown);
    },
    lines,
  };
}

test("proxy: initialize → tools/list → tools/call round-trip", async () => {
  const srv = await startServer();
  const sink = collectStdout();
  const proxy = createProxy(
    { baseUrl: srv.url, token: "kryton_test" },
    {
      logger: createLogger({ enabled: false }),
      stdout: sink.write,
      sleep: () => Promise.resolve(),
    },
  );

  await proxy.forward({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await proxy.forward({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await proxy.forward({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kryton.notes.list", arguments: {} },
  });
  await proxy.close();
  await srv.close();

  assert.equal(srv.posts.length, 3);
  assert.equal(srv.authHeaders[0], "Bearer kryton_test");
  // Session id captured after initialize and reused on subsequent posts.
  assert.equal(srv.posts[0]?.sessionId, null);
  assert.notEqual(srv.posts[1]?.sessionId, null);
  assert.equal(srv.posts[1]?.sessionId, srv.posts[2]?.sessionId);

  // Stdout: initialize result, tools/list result, then SSE-streamed
  // progress notification + tools/call result.
  assert.equal(sink.lines.length, 4);
  const first = sink.lines[0] as { id?: number };
  const second = sink.lines[1] as { id?: number; result?: { tools: unknown[] } };
  const third = sink.lines[2] as { method?: string };
  const fourth = sink.lines[3] as { id?: number; result?: { content: unknown[] } };
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.deepEqual(second.result?.tools.length, 1);
  assert.equal(third.method, "progress");
  assert.equal(fourth.id, 3);
});

test("proxy: 404 on a request drops cached session and retries", async () => {
  let initCount = 0;
  const srv = await startServer({
    postOverrides: [undefined as unknown as { mode: "auto" }, { mode: "404" }],
    sessionFactory: () => `sess-${++initCount}`,
  });
  const sink = collectStdout();
  const proxy = createProxy(
    { baseUrl: srv.url, token: "kryton_test" },
    {
      logger: createLogger({ enabled: false }),
      stdout: sink.write,
      sleep: () => Promise.resolve(),
    },
  );

  await proxy.forward({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  // tools/list — POST #2 returns 404 by override; the proxy must drop the
  // session id and retry. The retry attempt goes through as POST #3 with
  // no session header, which the server treats as a fresh call requiring
  // initialize. To make the retry succeed cleanly we instead expect the
  // synthesised error path: the second attempt also lacks a session and
  // tools/list returns 404 → proxy gives up and emits a JSON-RPC error.
  await proxy.forward({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await proxy.close();
  await srv.close();

  // Session was reset between attempts: POST #2 had a session id, the
  // retry (POST #3) had none.
  assert.ok(srv.posts.length >= 3);
  assert.notEqual(srv.posts[1]?.sessionId, null);
  assert.equal(srv.posts[2]?.sessionId, null);
  // The retry without a session id 404s → proxy emits a synthesised error
  // for the original tools/list request (id=2).
  const err = sink.lines.find(
    (m): m is { id: number; error: { code: number; message: string } } =>
      typeof m === "object" && m !== null && "error" in m,
  );
  assert.ok(err, "expected a synthesised JSON-RPC error on stdout");
  assert.equal(err.id, 2);
  assert.equal(err.error.code, -32000);
});

test("proxy: upstream HTTP 500 surfaces clean JSON-RPC error", async () => {
  const srv = await startServer({
    postOverrides: [undefined as unknown as { mode: "auto" }, { mode: "500" }],
  });
  const sink = collectStdout();
  const proxy = createProxy(
    { baseUrl: srv.url, token: "kryton_test" },
    {
      logger: createLogger({ enabled: false }),
      stdout: sink.write,
      sleep: () => Promise.resolve(),
    },
  );

  await proxy.forward({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await proxy.forward({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} });
  await proxy.close();
  await srv.close();

  const err = sink.lines.find(
    (m): m is { id: number; error: { code: number; message: string } } =>
      typeof m === "object" && m !== null && "error" in m,
  );
  assert.ok(err);
  assert.equal(err.id, 7);
  assert.match(err.error.message, /HTTP 500/);
});

test("proxy: unreachable upstream surfaces clean transport error", async () => {
  // 127.0.0.1:1 is reliably closed; fetch will fail synchronously.
  const sink = collectStdout();
  const proxy = createProxy(
    { baseUrl: "http://127.0.0.1:1", token: "kryton_test" },
    {
      logger: createLogger({ enabled: false }),
      stdout: sink.write,
      sleep: () => Promise.resolve(),
    },
  );
  await proxy.forward({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} });
  await proxy.close();

  assert.equal(sink.lines.length, 1);
  const err = sink.lines[0] as { id: number; error: { code: number; message: string } };
  assert.equal(err.id, 9);
  assert.equal(err.error.code, -32000);
  assert.match(err.error.message, /unreachable/i);
});
