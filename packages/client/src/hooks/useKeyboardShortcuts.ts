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
}

export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    hotkeys('ctrl+b,command+b', (e) => { e.preventDefault(); actions.toggleSidebar(); });
    hotkeys('ctrl+p,command+p', (e) => { e.preventDefault(); actions.openQuickSwitcher(); });
    hotkeys('ctrl+k,command+k', (e) => { e.preventDefault(); actions.focusSearch(); });
    hotkeys('ctrl+n,command+n', (e) => { e.preventDefault(); actions.createNote(); });
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
      hotkeys.unbind('f2');
      hotkeys.unbind('ctrl+shift+s,command+shift+s');
    };
  }, [actions]);
}
