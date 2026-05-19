/**
 * sidebarPrefs — module-scoped store for per-plugin sidebar side preference.
 *
 * Plugins register sidebar panels that historically rendered only in the
 * left sidebar. v1 of the placement feature lets the user move any panel
 * between the left sidebar and the right (graph) rail. The choice is per
 * browser, persisted in localStorage under a single JSON-encoded map.
 *
 * The store is intentionally tiny: a plain object cached in memory, a
 * subscribe/notify pair for React integration via useSyncExternalStore,
 * and best-effort localStorage I/O that survives quota / private-mode
 * failures silently (we never block the UI on a storage hiccup).
 */
import { useSyncExternalStore } from 'react';

export type Side = 'left' | 'right';

const STORAGE_KEY = 'kryton:plugin-sidebar-sides';

/** In-memory cache. Lazy-loaded from localStorage on first read. */
let cache: Record<string, Side> | null = null;
const listeners = new Set<() => void>();

function isSide(v: unknown): v is Side {
  return v === 'left' || v === 'right';
}

function load(): Record<string, Side> {
  if (cache) return cache;
  cache = {};
  if (typeof window === 'undefined') return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cache;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isSide(v)) cache[k] = v;
      }
    }
  } catch {
    // ignore — corrupted entry, treat as empty
  }
  return cache;
}

function persist(): void {
  if (typeof window === 'undefined' || !cache) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // quota exceeded / private mode — preference still lives in memory
  }
}

/**
 * Snapshot version counter — incremented on every successful setSide.
 * useSyncExternalStore compares snapshots with Object.is and bails out
 * when references match, so we expose a fresh primitive each time the
 * underlying map mutates rather than the (stable) cache reference.
 */
let snapshotVersion = 0;

export function getSide(pluginId: string): Side {
  const map = load();
  return map[pluginId] ?? 'left';
}

export function setSide(pluginId: string, side: Side): void {
  const map = load();
  if (map[pluginId] === side) return;
  map[pluginId] = side;
  snapshotVersion += 1;
  persist();
  for (const cb of listeners) cb();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Returns a fresh snapshot copy so React's useSyncExternalStore can diff. */
export function getAllSides(): Record<string, Side> {
  return { ...load() };
}

/**
 * Snapshot is a monotonic version number. Returning a primitive that
 * changes on every mutation means useSyncExternalStore re-renders
 * reliably, regardless of whether callers compare object identity.
 * Components that need the actual map call getAllSides() / getSide()
 * inside their render.
 */
function getSnapshotVersion(): number {
  return snapshotVersion;
}

/**
 * React hook — subscribes the calling component to side changes.
 * The returned value is a version counter; consumers should call
 * getSide / getAllSides directly during render to read current state.
 */
export function useSidebarSides(): number {
  return useSyncExternalStore(
    subscribe,
    getSnapshotVersion,
    getSnapshotVersion,
  );
}

/** Test-only — resets in-memory cache so tests can re-read storage. */
export function __resetForTests(): void {
  cache = null;
  snapshotVersion = 0;
  listeners.clear();
}
