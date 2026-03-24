import type { ClientPluginAPI } from '../../../types/client';

const { React, vim, getCM } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;

/** Determine the current vim mode string from the editor view. */
function getVimMode(view: any): string {
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
function getModeColor(mode: string): string {
  if (mode.includes('INSERT')) return 'text-green-500';
  if (mode.includes('VISUAL')) return 'text-orange-500';
  return 'text-violet-500';
}

// Shared mutable state so components can read the current mode.
let currentVimMode = '-- INSERT --';
let modeListeners: Array<(mode: string) => void> = [];

function setCurrentVimMode(mode: string): void {
  if (mode === currentVimMode) return;
  currentVimMode = mode;
  modeListeners.forEach((fn) => fn(mode));
}

function useModeListener(): string {
  const [mode, setMode] = useState(currentVimMode);
  useEffect(() => {
    modeListeners.push(setMode);
    return () => {
      modeListeners = modeListeners.filter((fn) => fn !== setMode);
    };
  }, []);
  return mode;
}

export function activate(api: ClientPluginAPI): void {
  // 1. Register the vim() CodeMirror extension
  api.editor.registerExtension(vim());

  // 2. Register vim toggle button in editor toolbar
  function VimToggle(): any {
    const settings = api.context.usePluginSettings('enabled');
    const enabled = settings !== false;

    function toggle(): void {
      const next = !enabled;
      // Persist setting (this will require a page reload to take effect
      // since CodeMirror extensions are set at editor creation time)
      api.api.fetch('/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      }).catch(() => {});
    }

    return h('div', { className: 'flex items-center gap-1.5 mr-2' },
      h('span', { className: 'text-xs text-gray-400' }, 'Vim'),
      h('button', {
        onClick: toggle,
        className: 'relative inline-flex h-5 w-9 items-center rounded-full transition-colors ' +
          (enabled ? 'bg-violet-500' : 'bg-gray-600'),
        title: enabled ? 'Disable Vim mode' : 'Enable Vim mode',
      },
        h('span', {
          className: 'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ' +
            (enabled ? 'translate-x-4' : 'translate-x-1'),
        })
      )
    );
  }

  api.ui.registerEditorToolbarButton(VimToggle, {
    id: 'vim-toggle',
    order: 100,
  });

  // 3. Register status bar mode indicator
  function VimModeIndicator(): any {
    const mode = useModeListener();
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

  // 4. Poll for vim mode changes (reads from active CodeMirror view)
  const pollInterval = setInterval(() => {
    const cmElement = document.querySelector('.cm-editor') as any;
    if (!cmElement) return;
    const view = cmElement.cmView?.view;
    if (!view) return;
    setCurrentVimMode(getVimMode(view));
  }, 200);

  (activate as any)._cleanup = () => {
    clearInterval(pollInterval);
    modeListeners = [];
  };

  // 5. Start in insert mode so beginners can type immediately
  const initTimeout = setTimeout(() => {
    const cmElement = document.querySelector('.cm-editor') as any;
    if (!cmElement) return;
    const view = cmElement.cmView?.view;
    if (!view) return;
    const cm = getCM(view);
    if (cm && cm.processKey) {
      cm.processKey('i');
      setCurrentVimMode('-- INSERT --');
    }
  }, 100);

  (activate as any)._initTimeout = initTimeout;
}

export function deactivate(): void {
  if ((activate as any)._cleanup) (activate as any)._cleanup();
  if ((activate as any)._initTimeout) clearTimeout((activate as any)._initTimeout);
}
