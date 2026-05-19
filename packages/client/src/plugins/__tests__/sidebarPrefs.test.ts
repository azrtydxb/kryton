import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'kryton:plugin-sidebar-sides';

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
    window.localStorage.removeItem(STORAGE_KEY);
    mod.__resetForTests();
  });

  // Aliases so the assertions below read naturally.
  const getSide = (id: string) => mod.getSide(id);
  const setSide = (id: string, s: 'left' | 'right') => mod.setSide(id, s);
  const subscribe = (cb: () => void) => mod.subscribe(cb);
  const getAllSides = () => mod.getAllSides();
  const __resetForTests = () => mod.__resetForTests();

  it('defaults to "left" for unknown plugins', () => {
    expect(getSide('unknown.plugin')).toBe('left');
  });

  it('round-trips through localStorage', () => {
    setSide('foo.plugin', 'right');
    setSide('bar.plugin', 'left');

    // Force re-load from storage.
    __resetForTests();

    expect(getSide('foo.plugin')).toBe('right');
    expect(getSide('bar.plugin')).toBe('left');

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({
      'foo.plugin': 'right',
    });
  });

  it('notifies subscribers when setSide changes the value', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(1);

    // No-op set should not notify.
    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(1);

    setSide('foo.plugin', 'left');
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    setSide('foo.plugin', 'right');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('getAllSides returns a snapshot copy', () => {
    setSide('a', 'right');
    setSide('b', 'left');
    const snap = getAllSides();
    expect(snap).toEqual({ a: 'right', b: 'left' });

    // Mutating the snapshot must not affect future reads.
    snap.a = 'left';
    expect(getSide('a')).toBe('right');
  });

  it('tolerates corrupted localStorage entries', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    __resetForTests();
    expect(getSide('foo')).toBe('left');
    expect(getAllSides()).toEqual({});
  });

  it('ignores entries with invalid side values', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ good: 'right', bad: 'middle', alsoBad: 42 }),
    );
    __resetForTests();
    expect(getSide('good')).toBe('right');
    expect(getSide('bad')).toBe('left');
    expect(getSide('alsoBad')).toBe('left');
  });
});
