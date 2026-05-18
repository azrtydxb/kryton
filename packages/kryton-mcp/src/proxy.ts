/**
 * Transparent JSON-RPC proxy from stdio MCP framing to Kryton's
 * Streamable HTTP MCP endpoint at `<baseUrl>/api/mcp`.
 *
 * Why hand-rolled (not `Server` from the SDK):
 * - Kryton's tool list is generated dynamically server-side from its
 *   OpenAPI spec. The shim must not validate or rewrite tool calls — it
 *   just shovels JSON-RPC frames in both directions. The SDK's `Server`
 *   wants concrete schemas at registration time.
 *
 * Lifecycle:
 * 1. Read newline-delimited JSON-RPC requests on stdin.
 * 2. POST each to `<baseUrl>/api/mcp` with `Authorization: Bearer …`
 *    and the current `mcp-session-id` (if any).
 * 3. The response is either a single JSON object or a `text/event-stream`
 *    of multiple messages — both are emitted to stdout as NDJSON.
 * 4. On the first response, capture `mcp-session-id` from headers, then
 *    open a long-poll `GET <baseUrl>/api/mcp` SSE channel for
 *    server→client notifications. The channel reconnects with
 *    exponential backoff on disconnect.
 * 5. On HTTP 404 for a POST we treat the session as lost: drop the
 *    cached id, reopen, retry the original request once.
 */

import { SseDecoder, type SseEvent } from "./sse.js";
import type { Logger } from "./logger.js";

export interface ProxyConfig {
  baseUrl: string;
  token: string;
}

export interface ProxyDeps {
  logger: Logger;
  /** Override the global fetch (used by tests). */
  fetch?: typeof fetch;
  /** Output sink for server→client JSON-RPC messages (NDJSON lines). */
  stdout?: (line: string) => void;
  /** Sleeper hook for backoff (used by tests). */
  sleep?: (ms: number) => Promise<void>;
}

interface InternalDeps {
  logger: Logger;
  fetch: typeof fetch;
  stdout: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
}

const NOTIFICATIONS_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const MAX_REQUEST_RETRIES = 1;

export interface Proxy {
  /** Feed one JSON-RPC request (already parsed from an NDJSON line). */
  forward(message: unknown): Promise<void>;
  /** Begin the GET-side notifications pump. Non-blocking; runs until close(). */
  startNotifications(): void;
  /** Stop background loops; idempotent. */
  close(): Promise<void>;
}

export function createProxy(config: ProxyConfig, depsIn: ProxyDeps): Proxy {
  const deps: InternalDeps = {
    logger: depsIn.logger,
    fetch: depsIn.fetch ?? globalThis.fetch,
    stdout: depsIn.stdout ?? ((line: string) => process.stdout.write(line)),
    sleep: depsIn.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };

  const endpoint = `${config.baseUrl}/api/mcp`;
  let sessionId: string | undefined;
  let closed = false;
  let notificationsAbort: AbortController | undefined;
  let notificationsLoop: Promise<void> | undefined;

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${config.token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...extra,
    };
  }

  function captureSession(headers: Headers): void {
    const sid = headers.get("mcp-session-id");
    if (sid && sid !== sessionId) {
      sessionId = sid;
      deps.logger.debug("session-captured", { sessionId });
    }
  }

  function emit(message: unknown): void {
    try {
      deps.stdout(JSON.stringify(message) + "\n");
    } catch (err) {
      deps.logger.error("stdout-emit-failed", { error: (err as Error).message });
    }
  }

  /** Parse an SSE event from /api/mcp into a JSON-RPC message and emit. */
  function emitSseEvent(ev: SseEvent): void {
    // The MCP streamable transport uses `event: message` with `data: <json>`.
    // Other event names (endpoint, ping) are ignored — Kryton's server is
    // expected to emit only `message` frames over the wire for JSON-RPC.
    if (ev.event !== "message") {
      deps.logger.debug("sse-non-message-ignored", { event: ev.event });
      return;
    }
    if (ev.data.length === 0) return;
    try {
      const parsed = JSON.parse(ev.data) as unknown;
      emit(parsed);
    } catch (err) {
      deps.logger.warn("sse-parse-failed", {
        error: (err as Error).message,
        data: ev.data.slice(0, 200),
      });
    }
  }

  async function consumeSseBody(res: Response): Promise<void> {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const ev of sse.push(chunk)) emitSseEvent(ev);
      }
      const tail = decoder.decode();
      if (tail.length > 0) {
        for (const ev of sse.push(tail)) emitSseEvent(ev);
      }
      const final = sse.flush();
      if (final) emitSseEvent(final);
    } finally {
      reader.releaseLock();
    }
  }

  async function postOnce(payload: unknown): Promise<Response> {
    return deps.fetch(endpoint, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      }),
      body: JSON.stringify(payload),
    });
  }

  async function forward(message: unknown): Promise<void> {
    if (closed) return;
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await postOnce(message);
      } catch (err) {
        deps.logger.error("upstream-fetch-failed", {
          error: (err as Error).message,
          attempt,
        });
        emitTransportError(message, `Kryton upstream unreachable: ${(err as Error).message}`);
        return;
      }
      captureSession(res.headers);
      if (res.status === 404 && sessionId !== undefined && attempt < MAX_REQUEST_RETRIES) {
        deps.logger.warn("session-lost-retry", { sessionId, attempt });
        sessionId = undefined;
        attempt += 1;
        // Drain and continue.
        await drainQuietly(res);
        continue;
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        deps.logger.error("upstream-error", {
          status: res.status,
          statusText: res.statusText,
          body: bodyText.slice(0, 500),
        });
        emitTransportError(
          message,
          `Kryton returned HTTP ${res.status} ${res.statusText}` +
            (bodyText ? `: ${bodyText.slice(0, 200)}` : ""),
        );
        return;
      }

      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (ctype.includes("text/event-stream")) {
        await consumeSseBody(res);
        return;
      }
      // 202 Accepted with no body — typical for notifications / responses.
      if (res.status === 202) {
        await drainQuietly(res);
        return;
      }
      if (ctype.includes("application/json")) {
        const json = (await res.json().catch(() => null)) as unknown;
        if (json !== null) emit(json);
        return;
      }
      // Unknown content type — drain and warn.
      const text = await res.text().catch(() => "");
      deps.logger.warn("unexpected-content-type", {
        contentType: ctype,
        bodyPreview: text.slice(0, 200),
      });
      return;
    }
  }

  function emitTransportError(req: unknown, message: string): void {
    // If the request had an id, synthesise a JSON-RPC error response so
    // the host doesn't hang waiting for one.
    const id = (req as { id?: unknown } | null)?.id;
    if (id === undefined || id === null) return;
    emit({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message,
      },
    });
  }

  function startNotifications(): void {
    if (notificationsLoop || closed) return;
    notificationsLoop = (async () => {
      let backoffIdx = 0;
      while (!closed) {
        if (!sessionId) {
          // No session yet — wait briefly and try again.
          await deps.sleep(250);
          continue;
        }
        const ac = new AbortController();
        notificationsAbort = ac;
        try {
          const res = await deps.fetch(endpoint, {
            method: "GET",
            headers: authHeaders({ accept: "text/event-stream" }),
            signal: ac.signal,
          });
          if (res.status === 404) {
            deps.logger.warn("notifications-session-lost", { sessionId });
            sessionId = undefined;
            continue;
          }
          if (res.status === 405) {
            // Server doesn't support server→client GET stream on this session.
            deps.logger.debug("notifications-not-supported");
            await deps.sleep(NOTIFICATIONS_BACKOFF_MS[NOTIFICATIONS_BACKOFF_MS.length - 1] ?? 30_000);
            continue;
          }
          if (!res.ok) {
            deps.logger.warn("notifications-http-error", {
              status: res.status,
              statusText: res.statusText,
            });
            await backoff();
            continue;
          }
          captureSession(res.headers);
          await consumeSseBody(res);
          deps.logger.debug("notifications-stream-closed");
          backoffIdx = 0;
        } catch (err) {
          if (closed) return;
          deps.logger.warn("notifications-error", { error: (err as Error).message });
          await backoff();
        } finally {
          notificationsAbort = undefined;
        }
      }

      async function backoff(): Promise<void> {
        const ms = NOTIFICATIONS_BACKOFF_MS[backoffIdx] ?? 30_000;
        backoffIdx = Math.min(backoffIdx + 1, NOTIFICATIONS_BACKOFF_MS.length - 1);
        await deps.sleep(ms);
      }
    })();
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    notificationsAbort?.abort();
    try {
      await notificationsLoop;
    } catch {
      /* ignore */
    }
    if (sessionId) {
      try {
        await deps.fetch(endpoint, {
          method: "DELETE",
          headers: authHeaders(),
        });
      } catch (err) {
        deps.logger.debug("delete-session-failed", { error: (err as Error).message });
      }
    }
  }

  return { forward, startNotifications, close };
}

async function drainQuietly(res: Response): Promise<void> {
  if (!res.body) return;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    /* ignore */
  }
}
