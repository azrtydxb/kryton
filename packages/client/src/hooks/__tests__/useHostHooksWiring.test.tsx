import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getHostHooks, resetHostHooks } from '@azrtydxb/ui';
import { useHostHooksWiring, type HostHooksWiringInput } from '../useHostHooksWiring';
import type { NoteData, AuthUser } from '../../lib/api';

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

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    role: 'user',
    avatarUrl: null,
    ...overrides,
  } as AuthUser;
}

function defaultInput(over: Partial<HostHooksWiringInput> = {}): HostHooksWiringInput {
  return {
    activeNote: makeNote(),
    closeActiveNote: vi.fn(),
    currentUser: makeUser(),
    theme: 'dark',
    ...over,
  };
}

describe('useHostHooksWiring', () => {
  beforeEach(() => {
    resetHostHooks();
  });

  it('installs saveCurrent + closePane when an active note is present', () => {
    renderHook(() => useHostHooksWiring(defaultInput()));

    const hooks = getHostHooks();
    expect(hooks.saveCurrent).toBeTypeOf('function');
    expect(hooks.closePane).toBeTypeOf('function');
  });

  it('saveCurrent resolves with {path, savedAt} for the active note', async () => {
    renderHook(() =>
      useHostHooksWiring(defaultInput({ activeNote: makeNote({ path: 'bar/baz.md' }) })),
    );

    const result = await getHostHooks().saveCurrent!();
    expect(result.path).toBe('bar/baz.md');
    expect(typeof result.savedAt).toBe('string');
    expect(() => new Date(result.savedAt).toISOString()).not.toThrow();
  });

  it('saveCurrent rejects when there is no active note', async () => {
    renderHook(() => useHostHooksWiring(defaultInput({ activeNote: null })));

    await expect(getHostHooks().saveCurrent!()).rejects.toThrow(/no active note/i);
  });

  it('closePane delegates to closeActiveNote', () => {
    const closeActiveNote = vi.fn();
    renderHook(() => useHostHooksWiring(defaultInput({ closeActiveNote })));

    act(() => {
      getHostHooks().closePane!();
    });
    expect(closeActiveNote).toHaveBeenCalledTimes(1);
  });

  it('clears the registry on unmount so stale closures dont leak', () => {
    const { unmount } = renderHook(() => useHostHooksWiring(defaultInput()));
    expect(getHostHooks().saveCurrent).toBeTypeOf('function');
    unmount();
    expect(getHostHooks().saveCurrent).toBeUndefined();
    expect(getHostHooks().closePane).toBeUndefined();
    expect(getHostHooks().currentUser).toBeUndefined();
    expect(getHostHooks().currentNote).toBeUndefined();
    expect(getHostHooks().theme).toBeUndefined();
  });

  it('publishes currentUser snapshot (id/name/email only)', () => {
    renderHook(() =>
      useHostHooksWiring(
        defaultInput({ currentUser: makeUser({ id: 'u9', name: 'Bob', email: 'bob@x.com' }) }),
      ),
    );
    expect(getHostHooks().currentUser).toEqual({
      id: 'u9',
      name: 'Bob',
      email: 'bob@x.com',
    });
  });

  it('publishes null currentUser when signed out', () => {
    renderHook(() => useHostHooksWiring(defaultInput({ currentUser: null })));
    expect(getHostHooks().currentUser).toBeNull();
  });

  it('publishes currentNote snapshot (path/content only)', () => {
    renderHook(() =>
      useHostHooksWiring(
        defaultInput({ activeNote: makeNote({ path: 'a/b.md', content: 'BODY' }) }),
      ),
    );
    expect(getHostHooks().currentNote).toEqual({ path: 'a/b.md', content: 'BODY' });
  });

  it('publishes theme', () => {
    renderHook(() => useHostHooksWiring(defaultInput({ theme: 'light' })));
    expect(getHostHooks().theme).toBe('light');
  });

  it('re-runs setHostHooks when theme changes', () => {
    const { rerender } = renderHook(
      (props: HostHooksWiringInput) => useHostHooksWiring(props),
      { initialProps: defaultInput({ theme: 'dark' }) },
    );
    expect(getHostHooks().theme).toBe('dark');
    rerender(defaultInput({ theme: 'light' }));
    expect(getHostHooks().theme).toBe('light');
  });

  it('re-runs setHostHooks when activeNote content changes', () => {
    const { rerender } = renderHook(
      (props: HostHooksWiringInput) => useHostHooksWiring(props),
      {
        initialProps: defaultInput({
          activeNote: makeNote({ path: 'x.md', content: 'v1' }),
        }),
      },
    );
    expect(getHostHooks().currentNote?.content).toBe('v1');
    rerender(
      defaultInput({ activeNote: makeNote({ path: 'x.md', content: 'v2' }) }),
    );
    expect(getHostHooks().currentNote?.content).toBe('v2');
  });
});
