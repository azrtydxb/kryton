// ──────────────────────────────────────────────────────────────────────────────
// Host hooks registry — module-scoped bridge from the host application to
// client-plugin API surface that isn't reachable via the editor registry.
//
// The shell (kryton-desktop / client) calls setHostHooks(...) at mount time
// to provide:
//   - saveCurrent(): persist the current editor buffer; resolve with the
//     saved path + ISO timestamp. Used by api.notes.saveCurrent().
//   - closePane(): close the currently focused note pane (Cmd+W intent).
//     Used by api.ui.closePane(). No-op when no pane is open.
//   - currentUser/currentNote/theme/pluginSettings: reactive snapshots of
//     host state that plugins read via api.context.useCurrent* / useTheme
//     / usePluginSettings. Whenever any of these change the shell calls
//     setHostHooks(...) again and every subscriber registered via
//     subscribeHostHooks() fires.
//
// This file intentionally has no UI / hook dependencies — plugins must keep
// working when no shell is mounted (e.g. unit tests).
// ──────────────────────────────────────────────────────────────────────────────

export interface HostHooksUser {
  id: string;
  name: string;
  email: string;
}

export interface HostHooksNote {
  path: string;
  content: string;
}

export interface HostHooks {
  saveCurrent?: () => Promise<{ path: string; savedAt: string }>;
  closePane?: () => void;
  // ── Reactive snapshots ──────────────────────────────────────────────────
  currentUser?: HostHooksUser | null;
  currentNote?: HostHooksNote | null;
  theme?: "light" | "dark";
  /** pluginSettings[pluginId][key] → value. */
  pluginSettings?: Record<string, Record<string, unknown>>;
}

export type HostHooksListener = () => void;

let hooks: HostHooks = {};
const listeners = new Set<HostHooksListener>();

/** Install host-provided implementations. Pass an empty object to clear. */
export function setHostHooks(next: HostHooks): void {
  hooks = { ...next };
  // Fire on every set — cheap and avoids equality-check complexity. Hook
  // consumers de-dupe via React's setState reference equality.
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      // A misbehaving subscriber must not break the rest.
      // eslint-disable-next-line no-console
      console.error("[host-hooks] subscriber threw:", err);
    }
  }
}

/** Read the current host hooks. Tests / api wrappers go through this. */
export function getHostHooks(): HostHooks {
  return hooks;
}

/**
 * Subscribe to host-hooks changes. Returns an unsubscribe function.
 * Plugins typically wire this into React.useEffect so re-renders fire on
 * host state changes.
 */
export function subscribeHostHooks(listener: HostHooksListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function resetHostHooks(): void {
  hooks = {};
  listeners.clear();
}
