import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarPref } from '../sidebarPrefs';

const LEGACY_STORAGE_KEY = 'kryton:plugin-sidebar-sides';

// Vitest 4 + jsdom in this workspace ships a null-prototype empty
// localStorage object (no getItem/setItem/etc.), so we install a real
// Map-backed shim before the module under test is imported. The shim
// matches the Web Storage interface closely enough for our needs.
beforeAll(() => {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

// Lazy import so the storage shim is installed before sidebarPrefs runs.
async function loadModule() {
  return await import('../sidebarPrefs');
}

describe('sidebarPrefs', () => {
  let mod: Awaited<ReturnType<typeof loadModule>>;
  beforeAll(async () => {
    mod = await loadModule();
  });

  beforeEach(() => {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    mod.__resetForTests();
  });

  // Aliases so the assertions below read naturally.
  const getSide = (id: string) => mod.getSide(id);
  const getPref = (id: string) => mod.getPref(id);
  const setSide = (id: string, s: 'left' | 'right') => mod.setSide(id, s);
  const moveUp = (id: string) => mod.moveUp(id);
  const moveDown = (id: string) => mod.moveDown(id);
  const subscribe = (cb: () => void) => mod.subscribe(cb);
  const getAllPrefs = () => mod.getAllPrefs();
  const setAllPrefs = (p: Record<string, SidebarPref>) => mod.setAllPrefs(p);
  const __resetForTests = () => mod.__resetForTests();

  it('defaults to {side:"left", order:0} for unknown plugins on a fresh store', () => {
    expect(getSide('unknown.plugin')).toBe('left');
    expect(getPref('unknown.plugin')).toEqual({ side: 'left', order: 0 });
  });

  it('setSide stores the new side and appends to the destination', () => {
    setSide('a', 'left');  // order 0 on left
    setSide('b', 'left');  // order 1 on left
    setSide('c', 'right'); // order 0 on right
    expect(getPref('a')).toEqual({ side: 'left', order: 0 });
    expect(getPref('b')).toEqual({ side: 'left', order: 1 });
    expect(getPref('c')).toEqual({ side: 'right', order: 0 });

    // Moving b → right appends at the end of right (order 1).
    setSide('b', 'right');
    expect(getPref('b')).toEqual({ side: 'right', order: 1 });
  });

  it('moveUp swaps order with the previous neighbour on the same side', () => {
    setSide('a', 'left');
    setSide('b', 'left');
    setSide('c', 'left');

    moveUp('c'); // c now above b
    const after1 = getAllPrefs();
    expect(after1.c.order).toBe(after1.b.order < after1.c.order ? after1.b.order : 1);
    // Simpler: assert order list.
    const ordered = Object.entries(getAllPrefs())
      .filter(([, p]) => p.side === 'left')
      .sort((x, y) => x[1].order - y[1].order)
      .map(([id]) => id);
    expect(ordered).toEqual(['a', 'c', 'b']);

    moveUp('c'); // c now at top
    const ordered2 = Object.entries(getAllPrefs())
      .filter(([, p]) => p.side === 'left')
      .sort((x, y) => x[1].order - y[1].order)
      .map(([id]) => id);
    expect(ordered2).toEqual(['c', 'a', 'b']);

    // No-op at top — order list unchanged.
    moveUp('c');
    const ordered3 = Object.entries(getAllPrefs())
      .filter(([, p]) => p.side === 'left')
      .sort((x, y) => x[1].order - y[1].order)
      .map(([id]) => id);
    expect(ordered3).toEqual(['c', 'a', 'b']);
  });

  it('moveDown swaps order with the next neighbour on the same side', () => {
    setSide('a', 'left');
    setSide('b', 'left');
    setSide('c', 'left');

    moveDown('a');
    const ordered = Object.entries(getAllPrefs())
      .filter(([, p]) => p.side === 'left')
      .sort((x, y) => x[1].order - y[1].order)
      .map(([id]) => id);
    expect(ordered).toEqual(['b', 'a', 'c']);

    // moveDown ignores plugins on a different side as neighbours.
    setSide('d', 'right');
    moveDown('d'); // d is alone on right — no-op
    expect(getPref('d')).toEqual({ side: 'right', order: 0 });
  });

  it('setAllPrefs round-trips and notifies subscribers', () => {
    const cb = vi.fn();
    subscribe(cb);
    setAllPrefs({
      a: { side: 'left', order: 0 },
      b: { side: 'right', order: 0 },
    });
    expect(cb).toHaveBeenCalled();
    expect(getAllPrefs()).toEqual({
      a: { side: 'left', order: 0 },
      b: { side: 'right', order: 0 },
    });
    expect(getSide('a')).toBe('left');
    expect(getSide('b')).toBe('right');
  });

  it('setAllPrefs drops invalid entries', () => {
    setAllPrefs({
      good: { side: 'right', order: 2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bad1: { side: 'middle' as any, order: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bad2: { side: 'left', order: 'x' as any },
    });
    expect(getAllPrefs()).toEqual({ good: { side: 'right', order: 2 } });
  });

  it('notifies subscribers when setSide / moveUp change state', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(1);

    // No-op set should not notify.
    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(1);

    setSide('bar.plugin', 'right');
    setSide('foo.plugin', 'left');
    expect(cb).toHaveBeenCalledTimes(3);

    unsub();
    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('getAllPrefs returns a snapshot copy', () => {
    setSide('a', 'right');
    setSide('b', 'left');
    const snap = getAllPrefs();
    expect(snap).toEqual({
      a: { side: 'right', order: 0 },
      b: { side: 'left', order: 0 },
    });

    // Mutating the snapshot must not affect future reads.
    snap.a.side = 'left';
    expect(getSide('a')).toBe('right');
  });

  it('migrates legacy v1 localStorage data on first read', () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ foo: 'right', bar: 'left' }),
    );
    __resetForTests();
    expect(getPref('foo').side).toBe('right');
    expect(getPref('bar').side).toBe('left');
  });

  it('tolerates corrupted legacy localStorage entries', () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, '{not json');
    __resetForTests();
    expect(getSide('foo')).toBe('left');
    expect(getAllPrefs()).toEqual({});
  });
});
