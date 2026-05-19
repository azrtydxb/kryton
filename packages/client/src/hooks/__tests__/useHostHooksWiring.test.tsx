import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getHostHooks, resetHostHooks } from '@azrtydxb/ui';
import { useHostHooksWiring } from '../useHostHooksWiring';
import type { NoteData } from '../../lib/api';

// The wiring's saveCurrent hits api.updateNote — stub it so the test
// doesn't touch the network.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      updateNote: vi.fn().mockResolvedValue(undefined),
    },
  };
});

function makeNote(overrides: Partial<NoteData> = {}): NoteData {
  return {
    path: 'foo.md',
    title: 'Foo',
    content: 'hello',
    modifiedAt: new Date().toISOString(),
    ...overrides,
  } as NoteData;
}

describe('useHostHooksWiring', () => {
  beforeEach(() => {
    resetHostHooks();
  });

  it('installs saveCurrent + closePane when an active note is present', () => {
    const closeActiveNote = vi.fn();
    renderHook(() =>
      useHostHooksWiring({ activeNote: makeNote(), closeActiveNote }),
    );

    const hooks = getHostHooks();
    expect(hooks.saveCurrent).toBeTypeOf('function');
    expect(hooks.closePane).toBeTypeOf('function');
  });

  it('saveCurrent resolves with {path, savedAt} for the active note', async () => {
    const closeActiveNote = vi.fn();
    renderHook(() =>
      useHostHooksWiring({
        activeNote: makeNote({ path: 'bar/baz.md' }),
        closeActiveNote,
      }),
    );

    const result = await getHostHooks().saveCurrent!();
    expect(result.path).toBe('bar/baz.md');
    expect(typeof result.savedAt).toBe('string');
    expect(() => new Date(result.savedAt).toISOString()).not.toThrow();
  });

  it('saveCurrent rejects when there is no active note', async () => {
    const closeActiveNote = vi.fn();
    renderHook(() =>
      useHostHooksWiring({ activeNote: null, closeActiveNote }),
    );

    await expect(getHostHooks().saveCurrent!()).rejects.toThrow(/no active note/i);
  });

  it('closePane delegates to closeActiveNote', () => {
    const closeActiveNote = vi.fn();
    renderHook(() =>
      useHostHooksWiring({ activeNote: makeNote(), closeActiveNote }),
    );

    act(() => {
      getHostHooks().closePane!();
    });
    expect(closeActiveNote).toHaveBeenCalledTimes(1);
  });

  it('clears the registry on unmount so stale closures dont leak', () => {
    const closeActiveNote = vi.fn();
    const { unmount } = renderHook(() =>
      useHostHooksWiring({ activeNote: makeNote(), closeActiveNote }),
    );
    expect(getHostHooks().saveCurrent).toBeTypeOf('function');
    unmount();
    expect(getHostHooks().saveCurrent).toBeUndefined();
    expect(getHostHooks().closePane).toBeUndefined();
  });
});
