// ──────────────────────────────────────────────────────────────────────────────
// useHostHooksWiring — bridge from the host shell into the @azrtydxb/ui
// plugin host-hooks registry.
//
// Plugins call api.notes.saveCurrent() and api.ui.closePane() through
// the registry; without a host implementation those calls are no-ops.
// This hook installs implementations on mount and clears them on
// unmount so unit tests (and a torn-down shell) don't leak stale
// closures into the registry.
//
// Inputs are intentionally narrow — just the slice of state the host
// hooks actually need — so the dependency footprint is obvious and
// stable.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { setHostHooks } from '@azrtydxb/ui';
import { api, type NoteData } from '../lib/api';

export interface HostHooksWiringInput {
  /** The currently-focused note (null when the empty state is showing). */
  activeNote: NoteData | null;
  /** Close the active note pane (clears the active tab + falls back to empty). */
  closeActiveNote: () => void;
}

/**
 * Install host-side implementations for the @azrtydxb/ui plugin
 * registry. Re-runs whenever the active note or the close callback
 * identity changes so closed-over state stays current.
 *
 * saveCurrent flushes the latest editor buffer straight to the HTTP
 * PUT endpoint — bypassing the debounced save in useNotes so the
 * promise resolves only after the disk write is acknowledged, which is
 * the contract api.notes.saveCurrent() advertises.
 */
export function useHostHooksWiring({ activeNote, closeActiveNote }: HostHooksWiringInput): void {
  useEffect(() => {
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
    });
    return () => {
      setHostHooks({});
    };
  }, [activeNote, closeActiveNote]);
}
