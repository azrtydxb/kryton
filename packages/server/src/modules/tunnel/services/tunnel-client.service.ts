/**
 * TunnelClient — state machine + reconnect loop for the persistent
 * yamux session to tunnel.kryton.ai.
 *
 * **NOTE: Phase 1 stub.** The actual h2 + yamux wire implementation
 * (4c spec §2.3 / §2.4) is deferred until the yamux library spike
 * is complete (see plan Task 7). This stub:
 *
 *  - holds the state machine and exposes the same `start/stop/restart/
 *    getStatus` API the admin routes call;
 *  - persists state transitions to TunnelStateService;
 *  - does NOT actually dial out — `start()` immediately transitions to
 *    `connecting` and then `fatal:unknown` after a short delay with a
 *    "tunnel client wire implementation pending" message.
 *
 * This shape lets us land the surrounding admin REST surface + UI in
 * a CI-green state. Replacing the body of `connectLoop` with the real
 * h2/yamux handshake is the only change needed once the spike lands.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §2.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { sanityCheck } from "../utils/jwt.js";
import type { TunnelClaims, TunnelStatus } from "../types.js";
import type { TunnelStateService } from "./tunnel-state.service.js";

type Deps = {
  state: TunnelStateService;
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
};

type FatalReason =
  | "invalid-jwt"
  | "revoked-jwt"
  | "subscription-inactive"
  | "duplicate-instance"
  | "unknown";

type InternalState =
  | { name: "idle"; message: string }
  | { name: "connecting" }
  | { name: "open"; subdomain: string; sessionId: string; connectedAt: number; tokenExpiresAt: number }
  | { name: "backoff"; nextAttemptAt: number; lastError: string }
  | { name: "fatal"; reason: FatalReason; message: string }
  | { name: "closing" };

export class TunnelClient extends EventEmitter {
  private internalState: InternalState = { name: "idle", message: "No token configured" };
  private connectController: AbortController | null = null;

  constructor(private readonly deps: Deps) {
    super();
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

  /**
   * Start (or replace) the connection loop with the given JWT. Returns
   * immediately; state transitions emit via the EventEmitter.
   */
  async start(jwt: string): Promise<void> {
    // Always stop any prior loop first.
    await this.stopInternal();

    const check = sanityCheck(jwt);
    if (!check.ok) {
      this.transition({ name: "fatal", reason: "invalid-jwt", message: check.message });
      await this.deps.state.setLastError(check.message);
      return;
    }
    const claims: TunnelClaims = check.claims;

    this.connectController = new AbortController();
    this.transition({ name: "connecting" });
    void this.connectLoop(jwt, claims, this.connectController.signal);
  }

  async stop(_opts: { timeoutMs?: number } = {}): Promise<void> {
    this.transition({ name: "closing" });
    await this.stopInternal();
    this.transition({ name: "idle", message: "No token configured" });
  }

  async restart(jwt: string): Promise<void> {
    await this.start(jwt);
  }

  /**
   * Force a fresh connect attempt — used by the admin "Try again"
   * button when in `fatal` or `backoff`.
   */
  async forceReconnect(): Promise<void> {
    const jwt = await this.deps.state.getJwt();
    if (!jwt) return;
    await this.start(jwt);
  }

  // ------------------------------------------------------------------

  private transition(next: InternalState): void {
    this.internalState = next;
    this.emit("state-change", this.getStatus());
  }

  private async stopInternal(): Promise<void> {
    if (this.connectController) {
      this.connectController.abort();
      this.connectController = null;
    }
  }

  /**
   * PHASE-1 STUB: the real implementation establishes an h2 connection
   * + CONNECT + yamux session per spec §2.3. For now we mark the
   * client as "fatal:unknown" after a short delay so the admin UI
   * surfaces a clear "not yet wired" state instead of pretending to be
   * connected.
   */
  private async connectLoop(jwt: string, claims: TunnelClaims, signal: AbortSignal): Promise<void> {
    void jwt;
    const log = this.deps.log;
    log?.info(
      { subdomain: claims.subdomain, jti: claims.jti },
      "tunnel client start (wire implementation pending Phase 3 spike)",
    );

    // Cache claims so the dashboard can show subdomain + expiry.
    await this.deps.state.setCachedClaims(claims).catch(() => undefined);

    // Mock "tried, failed, won't retry" so we don't burn an infinite
    // backoff loop in production until the real impl lands.
    await delay(250, signal).catch(() => undefined);
    if (signal.aborted) return;

    const sessionId = randomUUID();
    void sessionId; // not used in the stub
    this.transition({
      name: "fatal",
      reason: "unknown",
      message:
        "Tunnel wire implementation pending. The yamux + h2 transport will be enabled in the next release.",
    });
    await this.deps.state
      .setLastError("tunnel wire implementation pending")
      .catch(() => undefined);
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
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
