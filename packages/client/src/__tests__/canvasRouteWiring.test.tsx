/**
 * Unit test for the onCanvasRoute → enterEditMode wiring introduced in
 * App.tsx (Work item 1 of the Phase 0e loose-end).
 *
 * We exercise the pattern with a minimal test hook that mirrors the logic
 * in AppContent:
 *   - useUrlSync fires onCanvasRoute when a /canvas/:id URL is applied
 *   - a pendingCanvasEdit ref records the canvas id
 *   - a useEffect watching activeNote calls enterEditMode once the note loads
 *
 * This avoids rendering the full App (which has heavy provider deps) while
 * still covering the exact branching logic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffect, useRef, useCallback } from 'react';
import { useUrlSync } from '../hooks/useUrlSync';
import { useUIStore } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';
import type { NoteData } from '../lib/api';

// ── helpers ────────────────────────────────────────────────────────────────

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

function resetStores() {
  useUIStore.setState({ view: 'note', openTabs: [] });
  useToastStore.setState({ toasts: [] });
}

/** Minimal replica of the AppContent wiring under test. */
function useCanvasRouteWiring({
  activeNote,
  openNote,
  enterEditMode,
}: {
  activeNote: NoteData | null;
  openNote: (path: string) => void;
  enterEditMode: () => void;
}) {
  const pendingCanvasEdit = useRef<string | null>(null);

  const onCanvasRoute = useCallback(() => {
    const match = window.location.pathname.match(/^\/canvas\/(.+)$/);
    pendingCanvasEdit.current = match ? decodeURIComponent(match[1]) : null;
  }, []);

  useUrlSync(activeNote?.path ?? null, {
    openNote,
    openSharedNote: vi.fn(),
    closeActiveNote: vi.fn(),
    noteExists: () => true,
    onCanvasRoute,
  });

  useEffect(() => {
    if (!pendingCanvasEdit.current) return;
    if (!activeNote) return;
    if (activeNote.path !== pendingCanvasEdit.current) return;
    pendingCanvasEdit.current = null;
    enterEditMode();
  }, [activeNote, enterEditMode]);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('onCanvasRoute → enterEditMode wiring', () => {
  beforeEach(() => {
    resetStores();
    setUrl('/');
  });

  it('navigating to /canvas/X.canvas calls openNote with X.canvas', () => {
    setUrl('/canvas/X.canvas');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    renderHook(() =>
      useCanvasRouteWiring({ activeNote: null, openNote, enterEditMode }),
    );

    expect(openNote).toHaveBeenCalledWith('X.canvas');
  });

  it('enterEditMode is NOT called before the note loads', () => {
    setUrl('/canvas/X.canvas');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    renderHook(() =>
      useCanvasRouteWiring({ activeNote: null, openNote, enterEditMode }),
    );

    // activeNote is still null — enterEditMode must not fire yet
    expect(enterEditMode).not.toHaveBeenCalled();
  });

  it('enterEditMode is called once activeNote.path matches and content is loaded', () => {
    setUrl('/canvas/X.canvas');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    const loadedNote: NoteData = {
      path: 'X.canvas',
      title: 'X',
      content: '# Canvas content',
      modifiedAt: new Date().toISOString(),
    };

    const { rerender } = renderHook(
      ({ activeNote }: { activeNote: NoteData | null }) =>
        useCanvasRouteWiring({ activeNote, openNote, enterEditMode }),
      { initialProps: { activeNote: null as NoteData | null } },
    );

    expect(enterEditMode).not.toHaveBeenCalled();

    act(() => {
      rerender({ activeNote: loadedNote });
    });

    expect(enterEditMode).toHaveBeenCalledOnce();
  });

  it('enterEditMode is NOT called when a different note is active', () => {
    setUrl('/canvas/X.canvas');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    const wrongNote: NoteData = {
      path: 'Other.canvas',
      title: 'Other',
      content: '# Other',
      modifiedAt: new Date().toISOString(),
    };

    const { rerender } = renderHook(
      ({ activeNote }: { activeNote: NoteData | null }) =>
        useCanvasRouteWiring({ activeNote, openNote, enterEditMode }),
      { initialProps: { activeNote: null as NoteData | null } },
    );

    act(() => {
      rerender({ activeNote: wrongNote });
    });

    expect(enterEditMode).not.toHaveBeenCalled();
  });

  it('enterEditMode is called only once even if activeNote re-renders', () => {
    setUrl('/canvas/X.canvas');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    const loadedNote: NoteData = {
      path: 'X.canvas',
      title: 'X',
      content: '# Canvas content',
      modifiedAt: new Date().toISOString(),
    };

    const { rerender } = renderHook(
      ({ activeNote }: { activeNote: NoteData | null }) =>
        useCanvasRouteWiring({ activeNote, openNote, enterEditMode }),
      { initialProps: { activeNote: null as NoteData | null } },
    );

    act(() => {
      rerender({ activeNote: loadedNote });
    });
    act(() => {
      // Simulate a re-render with the same note (e.g. content update)
      rerender({ activeNote: { ...loadedNote, content: '# Updated' } });
    });

    expect(enterEditMode).toHaveBeenCalledOnce();
  });

  it('does not fire enterEditMode when there is no canvas navigation', () => {
    setUrl('/n/Regular.md');
    const openNote = vi.fn();
    const enterEditMode = vi.fn();

    const note: NoteData = {
      path: 'Regular.md',
      title: 'Regular',
      content: '# Regular note',
      modifiedAt: new Date().toISOString(),
    };

    const { rerender } = renderHook(
      ({ activeNote }: { activeNote: NoteData | null }) =>
        useCanvasRouteWiring({ activeNote, openNote, enterEditMode }),
      { initialProps: { activeNote: null as NoteData | null } },
    );

    act(() => {
      rerender({ activeNote: note });
    });

    expect(enterEditMode).not.toHaveBeenCalled();
  });
});
