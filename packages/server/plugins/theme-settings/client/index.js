const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;
const STYLE_ELEMENT_ID = "mnemo-theme-settings-styles";
function buildStyles(accentColor, fontSize, editorFont, lineHeight, contentWidth) {
  return `
/* Mnemo Theme Settings plugin */
:root {
  --accent-color: ${accentColor};
}

body {
  font-size: ${fontSize}px;
}

.cm-editor,
.cm-editor .cm-content {
  font-family: ${editorFont};
  line-height: ${lineHeight};
}

.markdown-preview {
  max-width: ${contentWidth}px;
  line-height: ${lineHeight};
}

/* Apply accent color to common interactive elements */
a,
.text-violet-500,
.text-purple-500 {
  color: var(--accent-color);
}

button.bg-violet-500,
button.bg-purple-500 {
  background-color: var(--accent-color) !important;
}
`.trim();
}
function applyStyles(css) {
  let el = document.getElementById(STYLE_ELEMENT_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
function removeStyles() {
  const el = document.getElementById(STYLE_ELEMENT_ID);
  if (el) el.remove();
}
function activate(api) {
  function ThemeSettingsSection() {
    const accentColor = api.context.usePluginSettings("accentColor") ?? "#8b5cf6";
    const fontSize = api.context.usePluginSettings("fontSize") ?? 14;
    const editorFont = api.context.usePluginSettings("editorFont") ?? "monospace";
    const lineHeight = api.context.usePluginSettings("lineHeight") ?? "1.6";
    const contentWidth = api.context.usePluginSettings("contentWidth") ?? 768;
    useEffect(() => {
      const css = buildStyles(accentColor, fontSize, editorFont, lineHeight, contentWidth);
      applyStyles(css);
    }, [accentColor, fontSize, editorFont, lineHeight, contentWidth]);
    const [localAccent, setLocalAccent] = useState(accentColor);
    const [localFontSize, setLocalFontSize] = useState(String(fontSize));
    const [localEditorFont, setLocalEditorFont] = useState(editorFont);
    const [localLineHeight, setLocalLineHeight] = useState(lineHeight);
    const [localContentWidth, setLocalContentWidth] = useState(String(contentWidth));
    function handlePreview() {
      const css = buildStyles(
        localAccent,
        Number(localFontSize) || 14,
        localEditorFont,
        localLineHeight,
        Number(localContentWidth) || 768
      );
      applyStyles(css);
      api.notify.success("Preview applied. Save your settings to persist.");
    }
    const rowClass = "flex flex-col gap-1 mb-4";
    const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-300";
    const inputClass = "w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500";
    return h(
      "div",
      { className: "p-4 max-w-md" },
      h(
        "h3",
        { className: "text-base font-semibold mb-4 text-gray-800 dark:text-gray-200" },
        "Appearance"
      ),
      // Accent color
      h(
        "div",
        { className: rowClass },
        h("label", { className: labelClass }, "Accent color"),
        h(
          "div",
          { className: "flex items-center gap-2" },
          h("input", {
            type: "color",
            value: localAccent,
            onChange: (e) => setLocalAccent(e.target.value),
            className: "h-8 w-12 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
          }),
          h("input", {
            type: "text",
            value: localAccent,
            onChange: (e) => setLocalAccent(e.target.value),
            className: inputClass + " flex-1",
            placeholder: "#8b5cf6"
          })
        )
      ),
      // Base font size
      h(
        "div",
        { className: rowClass },
        h("label", { className: labelClass }, "Base font size (px)"),
        h("input", {
          type: "number",
          value: localFontSize,
          onChange: (e) => setLocalFontSize(e.target.value),
          min: 10,
          max: 32,
          className: inputClass
        })
      ),
      // Editor font family
      h(
        "div",
        { className: rowClass },
        h("label", { className: labelClass }, "Editor font family"),
        h("input", {
          type: "text",
          value: localEditorFont,
          onChange: (e) => setLocalEditorFont(e.target.value),
          className: inputClass,
          placeholder: "monospace"
        })
      ),
      // Line height
      h(
        "div",
        { className: rowClass },
        h("label", { className: labelClass }, "Line height"),
        h("input", {
          type: "text",
          value: localLineHeight,
          onChange: (e) => setLocalLineHeight(e.target.value),
          className: inputClass,
          placeholder: "1.6"
        })
      ),
      // Content max width
      h(
        "div",
        { className: rowClass },
        h("label", { className: labelClass }, "Content max width (px)"),
        h("input", {
          type: "number",
          value: localContentWidth,
          onChange: (e) => setLocalContentWidth(e.target.value),
          min: 400,
          max: 1600,
          className: inputClass
        })
      ),
      // Preview button
      h("button", {
        onClick: handlePreview,
        className: "mt-2 px-4 py-2 text-sm rounded bg-violet-500 hover:bg-violet-600 text-white font-medium transition-colors"
      }, "Preview")
    );
  }
  api.ui.registerSettingsSection(ThemeSettingsSection, {
    id: "theme-settings",
    title: "Theme Settings"
  });
  function ThemeApplier() {
    const accentColor = api.context.usePluginSettings("accentColor") ?? "#8b5cf6";
    const fontSize = api.context.usePluginSettings("fontSize") ?? 14;
    const editorFont = api.context.usePluginSettings("editorFont") ?? "monospace";
    const lineHeight = api.context.usePluginSettings("lineHeight") ?? "1.6";
    const contentWidth = api.context.usePluginSettings("contentWidth") ?? 768;
    useEffect(() => {
      const css = buildStyles(accentColor, fontSize, editorFont, lineHeight, contentWidth);
      applyStyles(css);
    }, [accentColor, fontSize, editorFont, lineHeight, contentWidth]);
    return null;
  }
  api.ui.registerStatusBarItem(ThemeApplier, {
    id: "theme-settings-applier",
    position: "right",
    order: 999
  });
}
function deactivate() {
  removeStyles();
}
export {
  activate,
  deactivate
};
