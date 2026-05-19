import { useEffect, useState } from "react";
import { useHttpAdapter } from "../data/httpAdapterContext";
import type { VaultEvent } from "../data/vaultEvents.types";

/**
 * Open the `/ws/vault` push channel for the current session and route
 * every inbound `VaultEvent` through `HttpAdapter.applyVaultEvent` so
 * the in-memory caches stay in sync with vault changes initiated in
 * other tabs, by AI agents, or by external disk edits (once Phase 1.5
 * lands).
 *
 * The socket carries the adapter's `clientId` as a query-string param;
 * the server skips delivery back to the originator so the local
 * optimistic update isn't double-applied.
 *
 * Reconnection: this hook deliberately does NOT reconnect on close;
 * the existing `triggerSync()` full-refresh path is the fallback for
 * any drop, kept as-is from before this hook landed.
 */
export function useVaultEvents(): void {
  const adapter = useHttpAdapter();
  // The hook mounts at app load — before the user has signed in. We poll
  // session readiness on a short interval until a user appears, then open
  // the WS. The poll is cheap (one /api/auth/get-session per tick, cookie-
  // cached) and stops as soon as the socket is established. This keeps the
  // hook self-contained without coupling to the AuthProvider's loading/user
  // state.
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function open(): Promise<void> {
      // Gate on a live session so we don't spam a 401 before login.
      try {
        const res = await fetch("/api/auth/get-session", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) pollTimer = setTimeout(() => setAuthTick((t) => t + 1), 1500);
          return;
        }
        const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
        if (!data?.user) {
          if (!cancelled) pollTimer = setTimeout(() => setAuthTick((t) => t + 1), 1500);
          return;
        }
      } catch {
        if (!cancelled) pollTimer = setTimeout(() => setAuthTick((t) => t + 1), 1500);
        return;
      }
      if (cancelled) return;

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsBase = `${wsProtocol}//${window.location.host}`;
      const url = adapter.clientId
        ? `${wsBase}/ws/vault?clientId=${encodeURIComponent(adapter.clientId)}`
        : `${wsBase}/ws/vault`;

      try {
        socket = new WebSocket(url);
      } catch (err) {
        console.warn("[vault-events] socket construction failed", err);
        return;
      }

      socket.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") return;
        let parsed: VaultEvent;
        try {
          parsed = JSON.parse(ev.data) as VaultEvent;
        } catch (err) {
          console.warn("[vault-events] failed to parse event", err);
          return;
        }
        try {
          adapter.applyVaultEvent(parsed);
        } catch (err) {
          console.warn("[vault-events] applyVaultEvent threw", err, parsed);
        }
      });

      socket.addEventListener("error", (err) => {
        console.warn("[vault-events] socket error", err);
      });
    }

    void open();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
      socket = null;
    };
  }, [adapter, authTick]);
}
