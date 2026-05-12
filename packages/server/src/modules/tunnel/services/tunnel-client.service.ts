/**
 * TunnelClient — persistent yamux-over-h2 connection to the tunnel
 * server. Each inbound yamux stream is handed to the LoopbackInjector
 * which splices it to the local Fastify listener.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §2.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ClientHttp2Session, ClientHttp2Stream } from "node:http2";

import { sanityCheck } from "../utils/jwt.js";
import type { TunnelClaims, TunnelStatus } from "../types.js";
import {
  h2connectTunnel,
  TunnelHandshakeError,
} from "../wire/h2-connect.js";
import { YamuxSession, type YamuxStream } from "../wire/yamux.js";
import type { TunnelStateService } from "./tunnel-state.service.js";
import type { LoopbackInjector } from "./loopback-injector.service.js";

type Logger = {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

type FatalReason =
  | "invalid-jwt"
  | "revoked-jwt"
  | "subscription-inactive"
  | "duplicate-instance"
  | "unknown";

const FATAL_X_REASONS = new Set<FatalReason>([
  "invalid-jwt",
  "revoked-jwt",
  "subscription-inactive",
  "duplicate-instance",
]);

type InternalState =
  | { name: "idle"; message: string }
  | { name: "connecting" }
  | {
      name: "open";
      subdomain: string;
      sessionId: string;
      connectedAt: number;
      tokenExpiresAt: number;
      h2: ClientHttp2Session;
      yamux: YamuxSession;
      stream: ClientHttp2Stream;
    }
  | { name: "backoff"; nextAttemptAt: number; lastError: string }
  | { name: "fatal"; reason: FatalReason; message: string }
  | { name: "closing" };

export interface TunnelClientDeps {
  state: TunnelStateService;
  loopback: LoopbackInjector;
  log: Logger;
  /**
   * Tunnel server base URL. Default "https://tunnel.kryton.ai".
   * Override per-env for staging.
   */
  serverUrl?: string;
  /**
   * Reported as `x-kryton-version` on handshake.
   */
  krytonVersion?: string;
  /**
   * Initial reconnect backoff base in ms (1000 = 1 s, 2 s, 4 s, ...).
   */
  initialBackoffMs?: number;
  /**
   * Maximum reconnect backoff in ms.
   */
  maxBackoffMs?: number;
}

export class TunnelClient extends EventEmitter {
  private internalState: InternalState = {
    name: "idle",
    message: "No token configured",
  };
  private connectController: AbortController | null = null;
  private readonly serverUrl: string;
  private readonly krytonVersion: string;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly deps: TunnelClientDeps) {
    super();
    this.serverUrl = deps.serverUrl ?? "https://tunnel.kryton.ai";
    this.krytonVersion = deps.krytonVersion ?? "unknown";
    this.initialBackoffMs = deps.initialBackoffMs ?? 1_000;
    this.maxBackoffMs = deps.maxBackoffMs ?? 60_000;
  }

  getStatus(): TunnelStatus {
    const s = this.internalState;
    switch (s.name) {
      case "idle":
        return { state: "idle", message: s.message };
      case "connecting":
        return { state: "connecting" };
      case "open":
        return {
          state: "open",
          subdomain: s.subdomain,
          sessionId: s.sessionId,
          connectedAt: s.connectedAt,
          tokenExpiresAt: s.tokenExpiresAt,
        };
      case "backoff":
        return { state: "backoff", nextAttemptAt: s.nextAttemptAt, lastError: s.lastError };
      case "fatal":
        return { state: "fatal", reason: s.reason, message: s.message };
      case "closing":
        return { state: "closing" };
    }
  }

  async start(jwt: string): Promise<void> {
    await this.stopInternal();

    const check = sanityCheck(jwt);
    if (!check.ok) {
      this.transition({ name: "fatal", reason: "invalid-jwt", message: check.message });
      await this.deps.state.setLastError(check.message);
      return;
    }

    this.connectController = new AbortController();
    this.transition({ name: "connecting" });
    void this.connectLoop(jwt, check.claims, this.connectController.signal);
  }

  async stop(_opts: { timeoutMs?: number } = {}): Promise<void> {
    this.transition({ name: "closing" });
    await this.stopInternal();
    this.transition({ name: "idle", message: "No token configured" });
  }

  async restart(jwt: string): Promise<void> {
    await this.start(jwt);
  }

  async forceReconnect(): Promise<void> {
    const jwt = await this.deps.state.getJwt();
    if (!jwt) return;
    await this.start(jwt);
  }

  private transition(next: InternalState): void {
    this.internalState = next;
    this.emit("state-change", this.getStatus());
  }

  private async stopInternal(): Promise<void> {
    if (this.connectController) {
      this.connectController.abort();
      this.connectController = null;
    }
    const s = this.internalState;
    if (s.name === "open") {
      try {
        s.yamux.close("normal");
      } catch {
        /* already gone */
      }
      try {
        s.stream.close();
      } catch {
        /* */
      }
      try {
        s.h2.close();
      } catch {
        /* */
      }
    }
  }

  private async connectLoop(
    jwt: string,
    claims: TunnelClaims,
    signal: AbortSignal,
  ): Promise<void> {
    let attempt = 0;
    const instanceID = await this.deps.state.getInstanceId().catch(() => randomUUID());
    await this.deps.state.setCachedClaims(claims).catch(() => undefined);

    while (!signal.aborted) {
      try {
        this.transition({ name: "connecting" });
        const { session, stream, sessionID } = await h2connectTunnel({
          url: this.serverUrl,
          jwt,
          instanceID,
          krytonVersion: this.krytonVersion,
          signal,
        });
        attempt = 0;

        const yamux = new YamuxSession({
          socket: stream as unknown as NodeJS.ReadWriteStream,
          log: this.deps.log,
        });
        yamux.on("stream", (yStream: YamuxStream) => {
          this.deps.loopback.handle(yStream);
        });

        const closed = new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          yamux.once("close", done);
          session.once("close", done);
          stream.once("close", done);
        });

        const now = Date.now();
        this.transition({
          name: "open",
          subdomain: claims.subdomain,
          sessionId: sessionID,
          connectedAt: Math.floor(now / 1000),
          tokenExpiresAt: claims.exp,
          h2: session,
          yamux,
          stream,
        });
        await this.deps.state.setLastConnectedAt(new Date(now));
        await this.deps.state.clearLastError();
        this.deps.log.info("tunnel connected", {
          subdomain: claims.subdomain,
          session_id: sessionID,
        });

        await closed;
        this.deps.log.info("tunnel disconnected; will reconnect", {
          subdomain: claims.subdomain,
        });
      } catch (err) {
        const e = err as Error & { xReason?: string };
        if (err instanceof TunnelHandshakeError) {
          const reason = err.xReason as FatalReason;
          if (FATAL_X_REASONS.has(reason)) {
            this.transition({
              name: "fatal",
              reason,
              message: handshakeMessageFor(reason, err.status),
            });
            await this.deps.state.setLastError(`fatal: ${reason}`).catch(() => undefined);
            return;
          }
          await this.deps.state
            .setLastError(`handshake ${err.status} ${err.xReason}`)
            .catch(() => undefined);
        } else {
          await this.deps.state.setLastError(e.message).catch(() => undefined);
        }
        this.deps.log.warn("tunnel connect attempt failed", {
          err: e.message,
          attempt,
        });
      }

      if (signal.aborted) return;

      const backoff = jitter(
        Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** attempt),
      );
      attempt++;
      const nextAttemptAt = Math.floor(Date.now() / 1000) + Math.ceil(backoff / 1000);
      this.transition({
        name: "backoff",
        nextAttemptAt,
        lastError:
          (this.internalState as { lastError?: string }).lastError ??
          "connection failed",
      });
      try {
        await delay(backoff, signal);
      } catch {
        return; // aborted
      }
    }
  }
}

function handshakeMessageFor(reason: FatalReason, status: number): string {
  switch (reason) {
    case "invalid-jwt":
      return "Tunnel token is invalid. Paste a fresh token from your kryton.ai dashboard.";
    case "revoked-jwt":
      return "Tunnel token has been revoked. Get a new one from your kryton.ai dashboard.";
    case "subscription-inactive":
      return "Your subscription is no longer active. Manage billing on kryton.ai.";
    case "duplicate-instance":
      return "Another Kryton is already connected with this token. Rotate the token from kryton.ai if it wasn't you.";
    default:
      return `Handshake failed: ${status} ${reason}`;
  }
}

function jitter(ms: number): number {
  const variance = ms * 0.2;
  return ms + (Math.random() * 2 - 1) * variance;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
