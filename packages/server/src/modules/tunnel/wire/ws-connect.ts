/**
 * WebSocket control-transport helper.
 *
 * Opens an HTTP/1.1 WebSocket Upgrade to the tunnel server's `/control`
 * endpoint with the bearer JWT + instance headers, awaits the 101
 * response, and returns the socket as a Duplex bytestream. The caller
 * wraps the returned stream in a yamux session.
 *
 * Replaces the role of `h2-connect.ts` (HTTP/2 CONNECT), which AWS ALB
 * cannot proxy. See docs/superpowers/specs/2026-06-12-websocket-control-transport.md.
 */
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";

import { WebSocket, createWebSocketStream } from "ws";

import {
  TunnelHandshakeError,
  type HandshakeRejectReason,
} from "./h2-connect.js";

export { TunnelHandshakeError };
export type { HandshakeRejectReason };

export interface WsConnectOptions {
  /** Full URL of the tunnel server, e.g. "https://tunnel.kryton.ai". */
  url: string;
  /** JWT to present in Authorization: Bearer ... */
  jwt: string;
  /** Stable instance id from Settings, sent as x-kryton-instance-id. */
  instanceID: string;
  /** Kryton's package version. */
  krytonVersion: string;
  /** Connection-level idle timeout in ms (0 = no idle timeout). */
  idleTimeoutMs?: number;
  /** Abort signal. */
  signal?: AbortSignal;
}

export interface WsConnectResult {
  /** The live WebSocket connection. */
  ws: WebSocket;
  /** The WebSocket framed as a Node Duplex byte stream (binary). */
  stream: Duplex;
  /** The session id echoed by the server in `x-tunnel-session-id`. */
  sessionID: string;
}

/**
 * Map an `https:`/`http:` URL to its `wss:`/`ws:` control endpoint.
 *
 * The handshake path is `/control`; the host is taken from the server
 * URL. We preserve any explicit port.
 */
function toControlUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/control";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Open the WebSocket control connection. Resolves once the server has
 * completed the upgrade (HTTP 101); throws `TunnelHandshakeError` on a
 * rejected handshake (status + `x-reason`) or on a network error.
 */
export async function wsConnectTunnel(opts: WsConnectOptions): Promise<WsConnectResult> {
  const target = toControlUrl(opts.url);

  const ws = new WebSocket(target, {
    headers: {
      authorization: `Bearer ${opts.jwt}`,
      "x-kryton-version": opts.krytonVersion,
      "x-kryton-instance-id": opts.instanceID,
    },
    // Never let the lib's own idle ping/handshake timeout race us.
    handshakeTimeout: opts.idleTimeoutMs && opts.idleTimeoutMs > 0 ? opts.idleTimeoutMs : undefined,
  });

  // Captured from the 'upgrade' event (fires before 'open' on success).
  let upgradeRes: IncomingMessage | undefined;

  try {
    const sessionID = await new Promise<string>((resolve, reject) => {
      const onUpgrade = (res: IncomingMessage) => {
        upgradeRes = res;
      };
      const onOpen = () => {
        cleanup();
        const sid = headerValue(upgradeRes?.headers["x-tunnel-session-id"]) ?? "";
        resolve(sid);
      };
      const onUnexpected = (_req: unknown, res: IncomingMessage) => {
        cleanup();
        const status = res.statusCode ?? 0;
        const reason = headerValue(res.headers["x-reason"]) ?? "internal-error";
        // Drain so the socket can close cleanly.
        res.resume();
        ws.terminate();
        reject(new TunnelHandshakeError(status, reason));
      };
      const onError = (err: Error) => {
        cleanup();
        reject(new TunnelHandshakeError(0, "network-error", err.message));
      };
      const onAbort = () => {
        cleanup();
        ws.terminate();
        reject(new TunnelHandshakeError(0, "network-error", "aborted"));
      };

      const cleanup = () => {
        ws.off("upgrade", onUpgrade);
        ws.off("open", onOpen);
        ws.off("unexpected-response", onUnexpected);
        ws.off("error", onError);
        opts.signal?.removeEventListener("abort", onAbort);
      };

      ws.on("upgrade", onUpgrade);
      ws.once("open", onOpen);
      ws.once("unexpected-response", onUnexpected);
      ws.once("error", onError);

      if (opts.signal) {
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    // From here on the connection is live. Keep a catch-all error
    // listener so post-handshake socket errors (e.g. ECONNRESET on
    // shutdown) don't bubble up as unhandled; they surface as a
    // 'close' on the duplex instead.
    ws.on("error", () => undefined);

    const stream = createWebSocketStream(ws, { encoding: undefined });
    // The duplex can emit its own 'error' on abrupt close; absorb it so
    // it propagates as a 'close' to the yamux session rather than
    // crashing the process.
    stream.on("error", () => undefined);

    return { ws, stream, sessionID };
  } catch (err) {
    // Ensure the socket is fully torn down on any handshake failure.
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
    throw err;
  }
}

/** Coerce a Node header value (string | string[] | undefined) to a single string. */
function headerValue(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
