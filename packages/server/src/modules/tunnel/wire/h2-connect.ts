/**
 * HTTP/2 CONNECT helper.
 *
 * Establishes a TLS+h2 client connection to the tunnel server,
 * issues a CONNECT request with the bearer JWT, awaits the 200
 * response, and returns the CONNECT stream as a Duplex bytestream.
 * The caller wraps the returned stream in a yamux session.
 *
 * See umbrella spec §5.3 + 4c spec §2.3.
 */
import { connect as h2connect, type ClientHttp2Session, type ClientHttp2Stream } from "node:http2";
import { URL } from "node:url";

export interface H2ConnectOptions {
  /** Full URL of the tunnel server, e.g. "https://tunnel.kryton.ai". */
  url: string;
  /** JWT to present in Authorization: Bearer ... */
  jwt: string;
  /** Stable instance id from Settings, sent as x-kryton-instance-id. */
  instanceID: string;
  /** Kryton's package version. */
  krytonVersion: string;
  /** Optional explicit Authority header (defaults to URL host). */
  authority?: string;
  /** Connection-level idle timeout in ms (0 = no idle timeout). */
  idleTimeoutMs?: number;
  /** Abort signal. */
  signal?: AbortSignal;
}

export interface H2ConnectResult {
  session: ClientHttp2Session;
  stream: ClientHttp2Stream;
  sessionID: string;
}

/**
 * Possible reasons the tunnel server can reject our handshake. These
 * map to the x-reason response header (see spec §3.6).
 */
export type HandshakeRejectReason =
  | "invalid-jwt"
  | "revoked-jwt"
  | "subscription-inactive"
  | "duplicate-instance"
  | "internal-error"
  | "network-error";

export class TunnelHandshakeError extends Error {
  readonly status: number;
  readonly xReason: HandshakeRejectReason | string;
  constructor(status: number, xReason: string, msg?: string) {
    super(msg ?? `handshake failed: ${status} (${xReason})`);
    this.status = status;
    this.xReason = xReason;
  }
}

/**
 * Open the h2 session + CONNECT stream. Throws on rejection or
 * network error.
 */
export async function h2connectTunnel(opts: H2ConnectOptions): Promise<H2ConnectResult> {
  const url = new URL(opts.url);
  const authority = opts.authority ?? url.host;

  const session = h2connect(opts.url);
  // Always have an error listener attached so socket-level errors
  // (e.g. ECONNRESET on shutdown) don't bubble up as unhandled.
  session.on("error", () => undefined);
  // The internal TCP/TLS socket can emit ECONNRESET on shutdown
  // independently of the session's own error stream. Attach a
  // listener as soon as it exists.
  const attachSocketHandler = () => {
    const sock = session.socket;
    if (sock) sock.on("error", () => undefined);
  };
  attachSocketHandler();
  session.once("connect", attachSocketHandler);

  // Surface connect errors as a rejected promise. We pin a one-shot
  // 'error' listener that wraps the message; subsequent errors are
  // absorbed by the catch-all above.
  const onSessionError = new Promise<never>((_resolve, reject) => {
    session.once("error", (err: Error) => {
      reject(new TunnelHandshakeError(0, "network-error", err.message));
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        reject(new TunnelHandshakeError(0, "network-error", "aborted"));
      }, { once: true });
    }
  });

  // Wait for the session to connect before issuing CONNECT.
  await Promise.race([
    new Promise<void>((resolve) => session.once("connect", () => resolve())),
    onSessionError,
  ]);

  const stream = session.request({
    ":method": "CONNECT",
    ":authority": authority,
    authorization: `Bearer ${opts.jwt}`,
    "x-kryton-version": opts.krytonVersion,
    "x-kryton-instance-id": opts.instanceID,
  });
  stream.on("error", () => undefined);

  // Wait for response headers.
  const headers = await Promise.race([
    new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
      stream.once("response", (h) => resolve(h as Record<string, string | string[] | undefined>));
      stream.once("error", (err: Error) => {
        reject(new TunnelHandshakeError(0, "network-error", err.message));
      });
    }),
    onSessionError,
  ]);

  const status = Number(headers[":status"] ?? 0);
  if (status !== 200) {
    const reason = String(headers["x-reason"] ?? "internal-error");
    // Drain + close.
    stream.destroy();
    session.close();
    throw new TunnelHandshakeError(status, reason);
  }

  const sessionID = String(headers["x-tunnel-session-id"] ?? "");

  if (opts.idleTimeoutMs && opts.idleTimeoutMs > 0) {
    session.setTimeout(opts.idleTimeoutMs);
  }

  return { session, stream, sessionID };
}
