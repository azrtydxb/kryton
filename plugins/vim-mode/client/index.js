// Vim Mode Plugin for Mnemo
// Provides Vim keybindings, a toolbar toggle, and a status bar mode indicator.

const { React, vim, getCM } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback } = React;

/** Determine the current vim mode string from the editor view. */
function getVimMode(view) {
  const cm = getCM(view);
  if (!cm) return '-- NORMAL --';
  const vimState = cm.state.vim;
  if (!vimState) return '-- NORMAL --';
  if (vimState.insertMode) return '-- INSERT --';
  if (vimState.visualMode) {
    if (vimState.visualLine) return '-- VISUAL LINE --';
    if (vimState.visualBlock) return '-- VISUAL BLOCK --';
    return '-- VISUAL --';
  }
  return '-- NORMAL --';
}

/** Map a mode string to a Tailwind text-color class. */
function getModeColor(mode) {
  if (mode.includes('INSERT')) return 'text-green-500';
  if (mode.includes('VISUAL')) return 'text-orange-500';
  return 'text-violet-500';
}

// Shared mutable state so the status bar indicator can read the current mode.
let currentVimMode = '-- INSERT --';
let modeListeners = [];

function setCurrentVimMode(mode) {
  if (mode === currentVimMode) return;
  currentVimMode = mode;
  modeListeners.forEach((fn) => fn(mode));
}

export function activate(api) {
  // 1. Register the vim() CodeMirror extension
  const vimExt = vim();
  api.editor.registerExtension(vimExt);

  // 2. Register a status-bar mode indicator (left side, high priority)
  function VimModeIndicator() {
    const [mode, setMode] = useState(currentVimMode);

    useEffect(() => {
      modeListeners.push(setMode);
      return () => {
        modeListeners = modeListeners.filter((fn) => fn !== setMode);
      };
    }, []);

    return h(
      'div',
      { className: `font-semibold text-xs font-mono px-2 ${getModeColor(mode)}` },
      mode
    );
  }

  api.ui.registerStatusBarItem(VimModeIndicator, {
    id: 'vim-mode',
    position: 'left',
    order: 1,
  });

  // 3. Poll for vim mode changes via a CodeMirror update listener.
  //    We piggy-back on the editor view by registering a second extension
  //    that simply watches for updates and reads the vim state.
  //    (The EditorView.updateListener extension is available via @codemirror/view
  //    which is already in the host bundle.)
  //    Instead, we use a simpler approach: a setInterval that checks the
  //    focused editor view for the current vim mode.
  const pollInterval = setInterval(() => {
    // Find the active CodeMirror view via the DOM
    const cmElement = document.querySelector('.cm-editor');
    if (!cmElement) return;
    // EditorView stores itself on the DOM element
    const view = cmElement.cmView?.view;
    if (!view) return;
    setCurrentVimMode(getVimMode(view));
  }, 200);

  // Store cleanup reference
  activate._cleanup = () => {
    clearInterval(pollInterval);
    modeListeners = [];
  };

  // 4. Start in insert mode so beginners can type immediately.
  //    We need to wait for the editor to mount, so use a short delay.
  const initTimeout = setTimeout(() => {
    const cmElement = document.querySelector('.cm-editor');
    if (!cmElement) return;
    const view = cmElement.cmView?.view;
    if (!view) return;
    const cm = getCM(view);
    if (cm && cm.processKey) {
      cm.processKey('i');
      setCurrentVimMode('-- INSERT --');
    }
  }, 100);

  activate._initTimeout = initTimeout;
}

export function deactivate() {
  if (activate._cleanup) activate._cleanup();
  if (activate._initTimeout) clearTimeout(activate._initTimeout);
}
