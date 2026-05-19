/**
 * Regression test: flipping `sidebarEditMode` from true → false PUTs
 * the current sidebar layout to `/api/settings/ui:sidebarLayout` and
 * clears the legacy localStorage key on success.
 *
 * We render Header in isolation (with only the bits the toggle button
 * touches stubbed) and click the new "Customize sidebar layout" button
 * twice — once to enter edit mode, once to exit. The second click is
 * the one that should trigger the PUT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useRef } from 'react';

// Mock useAuth so UserMenu (rendered inside Header) doesn't blow up on
// the missing AuthProvider ancestor.
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Smoke', email: 'smoke@test', role: 'user' },
    logout: vi.fn(),
    loading: false,
    refetch: vi.fn(),
  }),
}));

// Mock api before importing Header so the import-time singleton sees
// the mocked module.
vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      updateSetting: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// PluginProvider is required by Header (PluginSlot renders inside).
import { PluginProvider, PluginSlotRegistry } from '@azrtydxb/ui';
import { Header } from '../Header';
import { api } from '../../../lib/api';
import {
  setSide,
  __resetForTests,
  clearLegacyStorage,
} from '../../../plugins/sidebarPrefs';
import { useUIStore } from '../../../stores/uiStore';

// jsdom in this workspace ships a null-prototype empty localStorage.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage,
});

function HeaderHarness() {
  const searchInputRef = useRef<HTMLInputElement | undefined>(undefined);
  const registry = useMemo(() => new PluginSlotRegistry(), []);
  return (
    <PluginProvider registry={registry}>
      <Header
        mobileMenuOpen={false}
        setMobileMenuOpen={() => {}}
        searchInputRef={searchInputRef}
        theme="dark"
        setTheme={() => {}}
        onNoteSelect={() => {}}
        onAdminClick={() => {}}
        onAccessRequestsClick={() => {}}
        activeNotePath={null}
      />
    </PluginProvider>
  );
}

describe('sidebar layout persistence (Header edit toggle)', () => {
  beforeEach(() => {
    store.clear();
    __resetForTests();
    useUIStore.getState().setSidebarEditMode(false);
    (api.updateSetting as unknown as { mockClear: () => void }).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('PUTs ui:sidebarLayout when leaving edit mode and clears legacy storage', async () => {
    // Seed a layout entry so the PUT body has something to assert on.
    setSide('demo.plugin', 'right');
    window.localStorage.setItem(
      'kryton:plugin-sidebar-sides',
      JSON.stringify({ demo: 'right' }),
    );

    render(<HeaderHarness />);
    const btn = screen.getByLabelText('Customize sidebar layout');
    fireEvent.click(btn); // enter edit mode

    expect(useUIStore.getState().sidebarEditMode).toBe(true);
    expect(api.updateSetting).not.toHaveBeenCalled();

    // The button's label flips while in edit mode.
    const exitBtn = screen.getByLabelText('Done — save layout');
    fireEvent.click(exitBtn); // exit edit mode → PUT + clear legacy

    expect(useUIStore.getState().sidebarEditMode).toBe(false);
    expect(api.updateSetting).toHaveBeenCalledTimes(1);
    const [key, body] = (api.updateSetting as unknown as { mock: { calls: [string, string][] } }).mock.calls[0];
    expect(key).toBe('ui:sidebarLayout');
    const parsed = JSON.parse(body) as Record<string, { side: string; order: number }>;
    expect(parsed['demo.plugin']).toEqual({ side: 'right', order: 0 });

    // Wait a microtask for the .then(clearLegacyStorage) to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(window.localStorage.getItem('kryton:plugin-sidebar-sides')).toBeNull();
  });

  it('does not PUT when entering edit mode', () => {
    render(<HeaderHarness />);
    fireEvent.click(screen.getByLabelText('Customize sidebar layout'));
    expect(api.updateSetting).not.toHaveBeenCalled();
    // Call exported helper just to keep the import live.
    clearLegacyStorage();
  });
});
