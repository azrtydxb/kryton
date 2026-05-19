// ──────────────────────────────────────────────────────────────────────────────
// useHostHooksWiring — bridge from the host shell into the @azrtydxb/ui
// plugin host-hooks registry.
//
// Plugins call api.notes.saveCurrent(), api.ui.closePane() and the
// api.context.use* hooks through the registry; without a host
// implementation those calls are no-ops / return null. This hook
// installs implementations on mount and re-installs them whenever any
// piece of host state (active note, current user, theme, …) changes so
// closed-over state and reactive snapshots stay current.
//
// Inputs are intentionally narrow — just the slice of state the host
// hooks actually need — so the dependency footprint is obvious and
// stable.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import {
  setHostHooks,
  type HostHooksUser,
  type HostHooksNote,
} from '@azrtydxb/ui';
import { api, type NoteData, type AuthUser } from '../lib/api';

export interface HostHooksWiringInput {
  /** The currently-focused note (null when the empty state is showing). */
  activeNote: NoteData | null;
  /** Close the active note pane (clears the active tab + falls back to empty). */
  closeActiveNote: () => void;
  /** The signed-in user, or null when not authenticated. */
  currentUser: AuthUser | null;
  /** Resolved theme ('light' | 'dark'). 'system' must be resolved by the caller. */
  theme: 'light' | 'dark';
}

/**
 * Install host-side implementations for the @azrtydxb/ui plugin
 * registry. Re-runs whenever any input changes so plugins observe
 * reactive updates via the subscribeHostHooks path.
 *
 * saveCurrent flushes the latest editor buffer straight to the HTTP
 * PUT endpoint — bypassing the debounced save in useNotes so the
 * promise resolves only after the disk write is acknowledged, which is
 * the contract api.notes.saveCurrent() advertises.
 */
export function useHostHooksWiring({
  activeNote,
  closeActiveNote,
  currentUser,
  theme,
}: HostHooksWiringInput): void {
  useEffect(() => {
    const hostUser: HostHooksUser | null = currentUser
      ? { id: currentUser.id, name: currentUser.name, email: currentUser.email }
      : null;
    const hostNote: HostHooksNote | null = activeNote
      ? { path: activeNote.path, content: activeNote.content }
      : null;

    setHostHooks({
      saveCurrent: async () => {
        if (!activeNote) {
          throw new Error('No active note to save');
        }
        await api.updateNote(activeNote.path, activeNote.content);
        return { path: activeNote.path, savedAt: new Date().toISOString() };
      },
      closePane: () => {
        closeActiveNote();
      },
      currentUser: hostUser,
      currentNote: hostNote,
      theme,
      // pluginSettings remains undefined here — a future change will
      // wire per-plugin settings (fetched lazily) into this slot.
    });
    return () => {
      setHostHooks({});
    };
  }, [activeNote, closeActiveNote, currentUser, theme]);
}
