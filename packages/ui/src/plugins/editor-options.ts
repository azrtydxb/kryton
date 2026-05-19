// ──────────────────────────────────────────────────────────────────────────────
// Editor options store — module-scoped observable bag for cross-plugin
// editor preferences (lineNumbers, wordWrap, …) that the EditorView
// reads on every render.
//
// Today's surface:
//   - "lineNumbers": boolean (default false) — toggles the line-number
//     gutter rendered by EditorView. vim-mode's :set number maps to this
//     via api.editor.setOption('lineNumbers', true).
//
// New options can be added without touching this file by setting any key
// via setEditorOption; consumers that don't recognize the key ignore it.
// ──────────────────────────────────────────────────────────────────────────────

export type EditorOptionValue = boolean | number | string;

export interface EditorOptions {
  lineNumbers?: boolean;
  [key: string]: EditorOptionValue | undefined;
}

export type EditorOptionsListener = (opts: EditorOptions) => void;

const DEFAULT_OPTIONS: Readonly<EditorOptions> = Object.freeze({
  lineNumbers: false,
});

let options: EditorOptions = { ...DEFAULT_OPTIONS };
const listeners = new Set<EditorOptionsListener>();

function notify(): void {
  const snap = { ...options };
  for (const cb of listeners) cb(snap);
}

/** Set a single option and notify subscribers. */
export function setEditorOption(name: string, value: EditorOptionValue): void {
  if (options[name] === value) return;
  options = { ...options, [name]: value };
  notify();
}

/** Read the current snapshot. */
export function getEditorOptions(): EditorOptions {
  return options;
}

/** Subscribe to option changes. Fires once with the current snapshot. */
export function subscribeEditorOptions(cb: EditorOptionsListener): () => void {
  listeners.add(cb);
  cb({ ...options });
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only reset. */
export function resetEditorOptions(): void {
  options = { ...DEFAULT_OPTIONS };
  listeners.clear();
}
