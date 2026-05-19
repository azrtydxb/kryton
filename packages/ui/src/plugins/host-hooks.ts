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
//
// This file intentionally has no UI / hook dependencies — plugins must keep
// working when no shell is mounted (e.g. unit tests).
// ──────────────────────────────────────────────────────────────────────────────

export interface HostHooks {
  saveCurrent?: () => Promise<{ path: string; savedAt: string }>;
  closePane?: () => void;
}

let hooks: HostHooks = {};

/** Install host-provided implementations. Pass an empty object to clear. */
export function setHostHooks(next: HostHooks): void {
  hooks = { ...next };
}

/** Read the current host hooks. Tests / api wrappers go through this. */
export function getHostHooks(): HostHooks {
  return hooks;
}

/** Test-only reset. */
export function resetHostHooks(): void {
  hooks = {};
}
