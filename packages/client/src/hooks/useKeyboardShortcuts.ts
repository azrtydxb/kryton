import { useEffect } from 'react';
import hotkeys from 'hotkeys-js';

interface ShortcutActions {
  toggleSidebar: () => void;
  toggleEdit: () => void;
  openQuickSwitcher: () => void;
  focusSearch: () => void;
  createNote: () => void;
  renameNote: () => void;
  toggleStar: () => void;
  /** Per design spec: ⌘N opens All Notes view. */
  openAllNotes?: () => void;
  /** Per design spec: ⌘G toggles Graph fullscreen. */
  toggleGraph?: () => void;
}

export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    hotkeys('ctrl+b,command+b', (e) => { e.preventDefault(); actions.toggleSidebar(); });
    hotkeys('ctrl+p,command+p', (e) => { e.preventDefault(); actions.openQuickSwitcher(); });
    hotkeys('ctrl+k,command+k', (e) => { e.preventDefault(); actions.focusSearch(); });
    // ⌘N — opens All Notes (per design spec). Falls back to createNote if no
    // openAllNotes wired (callers without the redesign integrated).
    hotkeys('ctrl+n,command+n', (e) => {
      e.preventDefault();
      if (actions.openAllNotes) actions.openAllNotes();
      else actions.createNote();
    });
    // ⌘⇧N — explicit create note, freed up by ⌘N taking on All Notes.
    hotkeys('ctrl+shift+n,command+shift+n', (e) => { e.preventDefault(); actions.createNote(); });
    // ⌘G — toggle Graph fullscreen (per design spec).
    hotkeys('ctrl+g,command+g', (e) => {
      if (!actions.toggleGraph) return;
      e.preventDefault();
      actions.toggleGraph();
    });
    hotkeys('f2', (e) => { e.preventDefault(); actions.renameNote(); });
    hotkeys('ctrl+shift+s,command+shift+s', (e) => { e.preventDefault(); actions.toggleStar(); });

    // Guard: skip Ctrl+E when focus is inside CodeMirror (Ctrl+E = cursor to line end in CM)
    hotkeys('ctrl+e,command+e', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor')) return;
      e.preventDefault();
      actions.toggleEdit();
    });

    return () => {
      hotkeys.unbind('ctrl+b,command+b');
      hotkeys.unbind('ctrl+e,command+e');
      hotkeys.unbind('ctrl+p,command+p');
      hotkeys.unbind('ctrl+k,command+k');
      hotkeys.unbind('ctrl+n,command+n');
      hotkeys.unbind('ctrl+shift+n,command+shift+n');
      hotkeys.unbind('ctrl+g,command+g');
      hotkeys.unbind('f2');
      hotkeys.unbind('ctrl+shift+s,command+shift+s');
    };
  }, [actions]);
}
