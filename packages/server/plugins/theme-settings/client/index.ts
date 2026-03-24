import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;

const STYLE_ELEMENT_ID = 'mnemo-theme-settings-styles';

/** Build the CSS string from the current settings values. */
function buildStyles(
  accentColor: string,
  fontSize: number,
  editorFont: string,
  lineHeight: string,
  contentWidth: number,
): string {
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

/** Inject or update the <style> element that carries theme overrides. */
function applyStyles(css: string): void {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** Remove the injected <style> element entirely. */
function removeStyles(): void {
  const el = document.getElementById(STYLE_ELEMENT_ID);
  if (el) el.remove();
}

// ---------------------------------------------------------------------------
// Plugin activation
// ---------------------------------------------------------------------------

export function activate(api: ClientPluginAPI): void {
  // --- Settings section UI ---

  function ThemeSettingsSection(): any {
    const accentColor = (api.context.usePluginSettings('accentColor') as string | null) ?? '#8b5cf6';
    const fontSize = (api.context.usePluginSettings('fontSize') as number | null) ?? 14;
    const editorFont = (api.context.usePluginSettings('editorFont') as string | null) ?? 'monospace';
    const lineHeight = (api.context.usePluginSettings('lineHeight') as string | null) ?? '1.6';
    const contentWidth = (api.context.usePluginSettings('contentWidth') as number | null) ?? 768;

    // Live-preview: apply styles whenever settings change
    useEffect(() => {
      const css = buildStyles(accentColor, fontSize, editorFont, lineHeight, contentWidth);
      applyStyles(css);
    }, [accentColor, fontSize, editorFont, lineHeight, contentWidth]);

    const [localAccent, setLocalAccent] = useState<string>(accentColor);
    const [localFontSize, setLocalFontSize] = useState<string>(String(fontSize));
    const [localEditorFont, setLocalEditorFont] = useState<string>(editorFont);
    const [localLineHeight, setLocalLineHeight] = useState<string>(lineHeight);
    const [localContentWidth, setLocalContentWidth] = useState<string>(String(contentWidth));

    function handlePreview(): void {
      const css = buildStyles(
        localAccent,
        Number(localFontSize) || 14,
        localEditorFont,
        localLineHeight,
        Number(localContentWidth) || 768,
      );
      applyStyles(css);
      api.notify.success('Preview applied. Save your settings to persist.');
    }

    const rowClass = 'flex flex-col gap-1 mb-4';
    const labelClass = 'text-sm font-medium text-gray-700 dark:text-gray-300';
    const inputClass =
      'w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 ' +
      'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
      'focus:outline-none focus:ring-2 focus:ring-violet-500';

    return h(
      'div',
      { className: 'p-4 max-w-md' },

      h('h3', { className: 'text-base font-semibold mb-4 text-gray-800 dark:text-gray-200' },
        'Appearance'),

      // Accent color
      h('div', { className: rowClass },
        h('label', { className: labelClass }, 'Accent color'),
        h('div', { className: 'flex items-center gap-2' },
          h('input', {
            type: 'color',
            value: localAccent,
            onChange: (e: any) => setLocalAccent(e.target.value),
            className: 'h-8 w-12 rounded cursor-pointer border border-gray-300 dark:border-gray-600',
          }),
          h('input', {
            type: 'text',
            value: localAccent,
            onChange: (e: any) => setLocalAccent(e.target.value),
            className: inputClass + ' flex-1',
            placeholder: '#8b5cf6',
          }),
        ),
      ),

      // Base font size
      h('div', { className: rowClass },
        h('label', { className: labelClass }, 'Base font size (px)'),
        h('input', {
          type: 'number',
          value: localFontSize,
          onChange: (e: any) => setLocalFontSize(e.target.value),
          min: 10,
          max: 32,
          className: inputClass,
        }),
      ),

      // Editor font family
      h('div', { className: rowClass },
        h('label', { className: labelClass }, 'Editor font family'),
        h('input', {
          type: 'text',
          value: localEditorFont,
          onChange: (e: any) => setLocalEditorFont(e.target.value),
          className: inputClass,
          placeholder: 'monospace',
        }),
      ),

      // Line height
      h('div', { className: rowClass },
        h('label', { className: labelClass }, 'Line height'),
        h('input', {
          type: 'text',
          value: localLineHeight,
          onChange: (e: any) => setLocalLineHeight(e.target.value),
          className: inputClass,
          placeholder: '1.6',
        }),
      ),

      // Content max width
      h('div', { className: rowClass },
        h('label', { className: labelClass }, 'Content max width (px)'),
        h('input', {
          type: 'number',
          value: localContentWidth,
          onChange: (e: any) => setLocalContentWidth(e.target.value),
          min: 400,
          max: 1600,
          className: inputClass,
        }),
      ),

      // Preview button
      h('button', {
        onClick: handlePreview,
        className:
          'mt-2 px-4 py-2 text-sm rounded bg-violet-500 hover:bg-violet-600 ' +
          'text-white font-medium transition-colors',
      }, 'Preview'),
    );
  }

  api.ui.registerSettingsSection(ThemeSettingsSection, {
    id: 'theme-settings',
    title: 'Theme Settings',
  });

  // Apply persisted settings on activation (initial load)
  // We read settings via a one-time component mount side-effect below.
  // Because we only have access to settings inside React components,
  // we trigger initial application through a tiny mount-only component
  // that is never visible but always renders.
  function ThemeApplier(): any {
    const accentColor = (api.context.usePluginSettings('accentColor') as string | null) ?? '#8b5cf6';
    const fontSize = (api.context.usePluginSettings('fontSize') as number | null) ?? 14;
    const editorFont = (api.context.usePluginSettings('editorFont') as string | null) ?? 'monospace';
    const lineHeight = (api.context.usePluginSettings('lineHeight') as string | null) ?? '1.6';
    const contentWidth = (api.context.usePluginSettings('contentWidth') as number | null) ?? 768;

    useEffect(() => {
      const css = buildStyles(accentColor, fontSize, editorFont, lineHeight, contentWidth);
      applyStyles(css);
    }, [accentColor, fontSize, editorFont, lineHeight, contentWidth]);

    return null;
  }

  // Register as a status-bar item with zero visual footprint so the
  // ThemeApplier component is mounted and can react to settings changes.
  api.ui.registerStatusBarItem(ThemeApplier, {
    id: 'theme-settings-applier',
    position: 'right',
    order: 999,
  });
}

export function deactivate(): void {
  removeStyles();
}
