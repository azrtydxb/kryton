import { useEffect } from "react";
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let cancelled = false;

    async function open(): Promise<void> {
      // Gate on a live session so we don't spam a 401 before login.
      try {
        const res = await fetch("/api/auth/get-session", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
        if (!data?.user) return;
      } catch {
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
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
      socket = null;
    };
  }, [adapter]);
}
