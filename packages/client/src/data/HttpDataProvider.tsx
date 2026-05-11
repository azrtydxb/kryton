/**
 * HttpDataProvider — wraps HttpAdapter in <KrytonDataProvider> and triggers
 * an initial full refresh once an authenticated session exists.
 *
 * Refreshes are gated on `/api/auth/get-session` returning a user, so the
 * pre-auth landing page doesn't fire a flood of 401s for every entity type.
 * A `kryton:auth-changed` window event re-runs the refresh after sign-in /
 * sign-out.
 *
 * Usage:
 *   const adapter = new HttpAdapter({ baseUrl: "" });
 *   <HttpDataProvider adapter={adapter}>...</HttpDataProvider>
 */

import { useEffect, type ReactNode } from "react";
import { KrytonDataProvider } from "@azrtydxb/ui";
import { HttpAdapter } from "./HttpAdapter";

interface HttpDataProviderProps {
  adapter: HttpAdapter;
  children: ReactNode;
}

const ENTITY_TYPES = [
  "notes",
  "tags",
  "settings",
  "noteShares",
  "trashItems",
  "currentUser",
] as const;

async function hasSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/get-session", { credentials: "include" });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
    return Boolean(data && data.user);
  } catch {
    return false;
  }
}

export function HttpDataProvider({ adapter, children }: HttpDataProviderProps) {
  useEffect(() => {
    let cancelled = false;

    async function refreshAll(): Promise<void> {
      if (cancelled) return;
      if (!(await hasSession())) return;
      for (const entityType of ENTITY_TYPES) {
        if (cancelled) return;
        adapter.refresh(entityType).catch((err: unknown) => {
          // Genuine post-auth refresh errors are still worth surfacing. The
          // common pre-auth 401 flood is now prevented by the session gate.
          console.warn(`[HttpDataProvider] refresh(${entityType}) failed:`, err);
        });
      }
    }

    void refreshAll();
    const onAuthChanged = (): void => { void refreshAll(); };
    window.addEventListener("kryton:auth-changed", onAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("kryton:auth-changed", onAuthChanged);
    };
  }, [adapter]);

  return <KrytonDataProvider adapter={adapter}>{children}</KrytonDataProvider>;
}
