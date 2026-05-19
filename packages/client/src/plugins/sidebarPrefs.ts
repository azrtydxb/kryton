/**
 * sidebarPrefs — module-scoped store for per-plugin sidebar placement.
 *
 * v2 of the placement feature lets the user choose both the side
 * (left/right) and the relative order of a panel within its side.
 * Preferences are persisted on the server under the per-user setting
 * key `ui:sidebarLayout` (JSON-encoded), but we keep a localStorage
 * fallback for the legacy v1 data — on first hydration we read the old
 * `kryton:plugin-sidebar-sides` map and migrate it on the next server
 * write.
 *
 * The store is intentionally tiny: a plain object cached in memory, a
 * subscribe/notify pair for React integration via useSyncExternalStore,
 * and best-effort localStorage I/O that survives quota / private-mode
 * failures silently. Server I/O is performed by the caller (the host
 * hooks wiring + the edit-mode toggle) — this module only owns the
 * in-memory shape and the legacy storage key.
 */
import { useSyncExternalStore } from 'react';

export type Side = 'left' | 'right';

export interface SidebarPref {
  side: Side;
  /** Smaller renders first within its side. */
  order: number;
}

const LEGACY_STORAGE_KEY = 'kryton:plugin-sidebar-sides';

/** In-memory cache. Lazy-loaded from localStorage on first read. */
let cache: Record<string, SidebarPref> | null = null;
const listeners = new Set<() => void>();

function isSide(v: unknown): v is Side {
  return v === 'left' || v === 'right';
}

function isPref(v: unknown): v is SidebarPref {
  if (!v || typeof v !== 'object') return false;
  const rec = v as Record<string, unknown>;
  return isSide(rec.side) && typeof rec.order === 'number' && Number.isFinite(rec.order);
}

function loadLegacy(): Record<string, SidebarPref> {
  const out: Record<string, SidebarPref> = {};
  if (typeof window === 'undefined') return out;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      let i = 0;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isSide(v)) {
          out[k] = { side: v, order: i };
          i += 1;
        }
      }
    }
  } catch {
    // ignore — corrupted entry, treat as empty
  }
  return out;
}

function load(): Record<string, SidebarPref> {
  if (cache) return cache;
  cache = loadLegacy();
  return cache;
}

/**
 * Snapshot version counter — incremented on every successful mutation.
 * useSyncExternalStore compares snapshots with Object.is and bails out
 * when references match, so we expose a fresh primitive each time the
 * underlying map mutates rather than the (stable) cache reference.
 */
let snapshotVersion = 0;

function bump(): void {
  snapshotVersion += 1;
  for (const cb of listeners) cb();
}

function defaultOrder(map: Record<string, SidebarPref>, side: Side): number {
  let max = -1;
  for (const p of Object.values(map)) {
    if (p.side === side && p.order > max) max = p.order;
  }
  return max + 1;
}

export function getPref(pluginId: string): SidebarPref {
  const map = load();
  return map[pluginId] ?? { side: 'left', order: defaultOrder(map, 'left') };
}

export function getSide(pluginId: string): Side {
  return getPref(pluginId).side;
}

export function setSide(pluginId: string, side: Side): void {
  const map = load();
  const cur = map[pluginId];
  if (cur && cur.side === side) return;
  // Moving to a new side appends at the end of the destination.
  map[pluginId] = { side, order: defaultOrder(map, side) };
  bump();
}

function neighbours(map: Record<string, SidebarPref>, side: Side): Array<[string, SidebarPref]> {
  return Object.entries(map)
    .filter(([, p]) => p.side === side)
    .sort((a, b) => a[1].order - b[1].order);
}

function swapOrder(map: Record<string, SidebarPref>, pluginId: string, delta: -1 | 1): boolean {
  const cur = map[pluginId];
  if (!cur) return false;
  const list = neighbours(map, cur.side);
  const idx = list.findIndex(([id]) => id === pluginId);
  if (idx === -1) return false;
  const swapIdx = idx + delta;
  if (swapIdx < 0 || swapIdx >= list.length) return false;
  const [otherId, other] = list[swapIdx];
  const tmp = cur.order;
  map[pluginId] = { side: cur.side, order: other.order };
  map[otherId] = { side: other.side, order: tmp };
  return true;
}

export function moveUp(pluginId: string): void {
  const map = load();
  // Ensure the plugin has an entry so the swap has something to operate on.
  if (!map[pluginId]) map[pluginId] = getPref(pluginId);
  if (swapOrder(map, pluginId, -1)) bump();
}

export function moveDown(pluginId: string): void {
  const map = load();
  if (!map[pluginId]) map[pluginId] = getPref(pluginId);
  if (swapOrder(map, pluginId, +1)) bump();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Returns a fresh snapshot copy so React's useSyncExternalStore can diff. */
export function getAllPrefs(): Record<string, SidebarPref> {
  const map = load();
  const out: Record<string, SidebarPref> = {};
  for (const [k, v] of Object.entries(map)) out[k] = { ...v };
  return out;
}

/**
 * Bulk-replace the in-memory map (used when hydrating from the server).
 * Invalid entries are skipped. Always notifies subscribers so the UI
 * re-renders against the freshly-loaded layout.
 */
export function setAllPrefs(next: Record<string, SidebarPref>): void {
  const clean: Record<string, SidebarPref> = {};
  for (const [k, v] of Object.entries(next ?? {})) {
    if (isPref(v)) clean[k] = { side: v.side, order: v.order };
  }
  cache = clean;
  bump();
}

/**
 * Snapshot is a monotonic version number. Returning a primitive that
 * changes on every mutation means useSyncExternalStore re-renders
 * reliably, regardless of whether callers compare object identity.
 * Components that need the actual map call getAllPrefs() / getPref()
 * inside their render.
 */
function getSnapshotVersion(): number {
  return snapshotVersion;
}

/**
 * React hook — subscribes the calling component to layout changes.
 * The returned value is a version counter; consumers should call
 * getPref / getAllPrefs directly during render to read current state.
 */
export function useSidebarSides(): number {
  return useSyncExternalStore(
    subscribe,
    getSnapshotVersion,
    getSnapshotVersion,
  );
}

/** Clears the legacy localStorage key once the server has the truth. */
export function clearLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore — best-effort cleanup
  }
}

/** Test-only — resets in-memory cache so tests can re-read storage. */
export function __resetForTests(): void {
  cache = null;
  snapshotVersion = 0;
  listeners.clear();
}
