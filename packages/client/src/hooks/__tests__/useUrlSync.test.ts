import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlSync, type UrlSyncCallbacks } from '../useUrlSync';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';

function makeCallbacks(overrides: Partial<UrlSyncCallbacks> = {}): UrlSyncCallbacks {
  return {
    openNote: vi.fn(),
    openSharedNote: vi.fn(),
    closeActiveNote: vi.fn(),
    noteExists: () => true,
    ...overrides,
  };
}

function resetStores() {
  useUIStore.setState({
    view: 'note',
    openTabs: [],
  });
  useToastStore.setState({ toasts: [] });
}

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

describe('useUrlSync — mount', () => {
  beforeEach(() => {
    resetStores();
    setUrl('/');
  });

  it('default URL → leaves view as note, calls closeActiveNote', () => {
    const cb = makeCallbacks();
    renderHook(() => useUrlSync(null, cb));
    expect(useUIStore.getState().view).toBe('note');
    expect(cb.closeActiveNote).toHaveBeenCalled();
  });

  it('parses /view/all and applies to uiStore', () => {
    setUrl('/view/all');
    renderHook(() => useUrlSync(null, makeCallbacks()));
    expect(useUIStore.getState().view).toBe('all');
  });

  it('parses /view/graph and applies', () => {
    setUrl('/view/graph');
    renderHook(() => useUrlSync(null, makeCallbacks()));
    expect(useUIStore.getState().view).toBe('graph');
  });

  it('parses /n/<path> → opens the note and seeds openTabs', () => {
    setUrl('/n/Welcome.md');
    const cb = makeCallbacks();
    renderHook(() => useUrlSync(null, cb));
    expect(useUIStore.getState().view).toBe('note');
    expect(useUIStore.getState().openTabs).toEqual(['Welcome.md']);
    expect(cb.openNote).toHaveBeenCalledWith('Welcome.md');
  });

  it('parses /n/<active>?tabs=… → opens active, restores tab order', () => {
    setUrl('/n/B.md?tabs=A.md,B.md,C.md');
    const cb = makeCallbacks();
    renderHook(() => useUrlSync(null, cb));
    expect(useUIStore.getState().openTabs).toEqual(['A.md', 'B.md', 'C.md']);
    expect(cb.openNote).toHaveBeenCalledWith('B.md');
  });

  it('drops missing tabs and toasts when noteExists returns false', () => {
    setUrl('/n/Gone.md?tabs=Alive.md,Gone.md');
    const cb = makeCallbacks({
      noteExists: (p) => p !== 'Gone.md',
    });
    renderHook(() => useUrlSync(null, cb));
    expect(useUIStore.getState().openTabs).toEqual(['Alive.md']);
    expect(cb.openNote).toHaveBeenCalledWith('Alive.md');
    expect(useToastStore.getState().toasts.length).toBe(1);
    expect(useToastStore.getState().toasts[0].message).toContain('Gone.md');
  });

  it('parses /shared/<owner>/<path> and calls openSharedNote', () => {
    setUrl('/shared/user-1/Folder/Note.md');
    const cb = makeCallbacks();
    renderHook(() => useUrlSync(null, cb));
    expect(cb.openSharedNote).toHaveBeenCalledWith('user-1', 'Folder/Note.md');
    expect(useUIStore.getState().openTabs).toContain('shared:user-1:Folder/Note.md');
  });
});

describe('useUrlSync — write on state change', () => {
  beforeEach(() => {
    resetStores();
    setUrl('/');
  });

  it('writes /view/all when view changes', () => {
    renderHook(() => useUrlSync(null, makeCallbacks()));
    act(() => {
      useUIStore.getState().setView('all');
    });
    expect(window.location.pathname).toBe('/view/all');
  });

  it('writes /n/<path> when a tab is opened with that as active', () => {
    const { rerender } = renderHook(
      ({ active }: { active: string | null }) => useUrlSync(active, makeCallbacks()),
      { initialProps: { active: null as string | null } },
    );
    act(() => {
      useUIStore.getState().openTab('Welcome.md');
    });
    rerender({ active: 'Welcome.md' });
    act(() => {
      // Trigger a no-op state change to force the URL writer to flush
      // with the updated `active` ref.
      useUIStore.getState().setView('note');
    });
    expect(window.location.pathname).toBe('/n/Welcome.md');
  });

  it('uses replaceState (no history growth) for pure tab-list changes', () => {
    setUrl('/n/A.md');
    useUIStore.setState({ openTabs: ['A.md'], view: 'note' });
    const { rerender } = renderHook(
      ({ active }: { active: string | null }) => useUrlSync(active, makeCallbacks()),
      { initialProps: { active: 'A.md' as string | null } },
    );
    rerender({ active: 'A.md' });
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    act(() => {
      useUIStore.getState().openTab('B.md');
    });
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it('uses pushState when the active note changes', () => {
    setUrl('/n/A.md');
    useUIStore.setState({ openTabs: ['A.md'], view: 'note' });
    const { rerender } = renderHook(
      ({ active }: { active: string | null }) => useUrlSync(active, makeCallbacks()),
      { initialProps: { active: 'A.md' as string | null } },
    );
    rerender({ active: 'A.md' });
    const pushSpy = vi.spyOn(window.history, 'pushState');
    act(() => {
      useUIStore.setState({ openTabs: ['A.md', 'B.md'] });
    });
    // First the tab-add fires (replaceState path) — clear and re-test the
    // active-change.
    pushSpy.mockClear();
    rerender({ active: 'B.md' });
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });
});

describe('useUrlSync — popstate', () => {
  beforeEach(() => {
    resetStores();
    setUrl('/');
  });

  it('re-parses URL on browser back/forward', () => {
    const cb = makeCallbacks();
    renderHook(() => useUrlSync(null, cb));
    setUrl('/view/graph');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(useUIStore.getState().view).toBe('graph');
  });
});
