const { React, vim, getCM } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;
function getVimMode(view) {
  const cm = getCM(view);
  if (!cm) return "-- NORMAL --";
  const vimState = cm.state.vim;
  if (!vimState) return "-- NORMAL --";
  if (vimState.insertMode) return "-- INSERT --";
  if (vimState.visualMode) {
    if (vimState.visualLine) return "-- VISUAL LINE --";
    if (vimState.visualBlock) return "-- VISUAL BLOCK --";
    return "-- VISUAL --";
  }
  return "-- NORMAL --";
}
function getModeColor(mode) {
  if (mode.includes("INSERT")) return "text-green-500";
  if (mode.includes("VISUAL")) return "text-orange-500";
  return "text-violet-500";
}
let currentVimMode = "-- INSERT --";
let modeListeners = [];
function setCurrentVimMode(mode) {
  if (mode === currentVimMode) return;
  currentVimMode = mode;
  modeListeners.forEach((fn) => fn(mode));
}
function useModeListener() {
  const [mode, setMode] = useState(currentVimMode);
  useEffect(() => {
    modeListeners.push(setMode);
    return () => {
      modeListeners = modeListeners.filter((fn) => fn !== setMode);
    };
  }, []);
  return mode;
}
function activate(api) {
  api.editor.registerExtension(vim());
  function VimToggle() {
    const settings = api.context.usePluginSettings("enabled");
    const enabled = settings !== false;
    function toggle() {
      const next = !enabled;
      api.api.fetch("/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next })
      }).catch(() => {
      });
    }
    return h(
      "div",
      { className: "flex items-center gap-1.5 mr-2" },
      h("span", { className: "text-xs text-gray-400" }, "Vim"),
      h(
        "button",
        {
          onClick: toggle,
          className: "relative inline-flex h-5 w-9 items-center rounded-full transition-colors " + (enabled ? "bg-violet-500" : "bg-gray-600"),
          title: enabled ? "Disable Vim mode" : "Enable Vim mode"
        },
        h("span", {
          className: "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform " + (enabled ? "translate-x-4" : "translate-x-1")
        })
      )
    );
  }
  api.ui.registerEditorToolbarButton(VimToggle, {
    id: "vim-toggle",
    order: 100
  });
  function VimModeIndicator() {
    const mode = useModeListener();
    return h(
      "div",
      { className: `font-semibold text-xs font-mono px-2 ${getModeColor(mode)}` },
      mode
    );
  }
  api.ui.registerStatusBarItem(VimModeIndicator, {
    id: "vim-mode",
    position: "left",
    order: 1
  });
  const pollInterval = setInterval(() => {
    const cmElement = document.querySelector(".cm-editor");
    if (!cmElement) return;
    const view = cmElement.cmView?.view;
    if (!view) return;
    setCurrentVimMode(getVimMode(view));
  }, 200);
  activate._cleanup = () => {
    clearInterval(pollInterval);
    modeListeners = [];
  };
  const initTimeout = setTimeout(() => {
    const cmElement = document.querySelector(".cm-editor");
    if (!cmElement) return;
    const view = cmElement.cmView?.view;
    if (!view) return;
    const cm = getCM(view);
    if (cm && cm.processKey) {
      cm.processKey("i");
      setCurrentVimMode("-- INSERT --");
    }
  }, 100);
  activate._initTimeout = initTimeout;
}
function deactivate() {
  if (activate._cleanup) activate._cleanup();
  if (activate._initTimeout) clearTimeout(activate._initTimeout);
}
export {
  activate,
  deactivate
};
