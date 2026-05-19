// ──────────────────────────────────────────────────────────────────────────────
// Editor plugin registry — bridges client plugins to the custom editor.
//
// Two responsibilities:
//  1. Track dynamically-registered EditorPlugins so the mounted
//     <EditorView /> can read them on every render and route them through
//     its `plugins` prop / onKeyDown cascade.
//  2. Expose the "active" editor to client plugins so they can call
//     dispatch(tr) / read getActiveState() / subscribe via onTransaction.
//
// The registry is module-scoped — there is exactly one editor visible to a
// given client plugin at a time (the host app mounts a single EditorView at
// most for the active note). Tests can call resetEditorRegistry() between
// runs to avoid bleeding state.
// ──────────────────────────────────────────────────────────────────────────────

import type { EditorPlugin, EditorState, Transaction } from "../editor/state";

export type EditorPluginListener = (plugins: readonly EditorPlugin[]) => void;
export type EditorTransactionListener = (
  tr: Transaction,
  state: EditorState,
) => void;

export interface EditorRegistryHandle {
  /** Latest known state of the active editor. */
  getState: () => EditorState | null;
  /** Dispatch a transaction to the active editor. */
  dispatch: (tr: Transaction) => void;
}

const dynamicPlugins = new Set<EditorPlugin>();
const pluginListeners = new Set<EditorPluginListener>();
const transactionListeners = new Set<EditorTransactionListener>();
let activeHandle: EditorRegistryHandle | null = null;

function notifyPluginListeners(): void {
  const snapshot = Array.from(dynamicPlugins);
  for (const cb of pluginListeners) cb(snapshot);
}

/** Add a plugin and return a disposer that removes it. */
export function registerEditorPlugin(plugin: EditorPlugin): () => void {
  dynamicPlugins.add(plugin);
  notifyPluginListeners();
  return () => {
    if (dynamicPlugins.delete(plugin)) notifyPluginListeners();
  };
}

/** Read the current set of dynamically-registered plugins. */
export function getEditorPlugins(): readonly EditorPlugin[] {
  return Array.from(dynamicPlugins);
}

/** Subscribe to changes in the dynamic plugin set. Returns a disposer. */
export function subscribeEditorPlugins(cb: EditorPluginListener): () => void {
  pluginListeners.add(cb);
  cb(Array.from(dynamicPlugins));
  return () => {
    pluginListeners.delete(cb);
  };
}

/** Subscribe to every transaction applied to the active editor. */
export function subscribeEditorTransactions(
  cb: EditorTransactionListener,
): () => void {
  transactionListeners.add(cb);
  return () => {
    transactionListeners.delete(cb);
  };
}

/** Fire all transaction listeners. Called by EditorView on every dispatch. */
export function emitEditorTransaction(
  tr: Transaction,
  state: EditorState,
): void {
  for (const cb of transactionListeners) {
    try {
      cb(tr, state);
    } catch (err) {
      console.error("[plugins] editor transaction listener threw:", err);
    }
  }
}

/** Set / clear the active editor handle (called by EditorView on mount/unmount). */
export function setActiveEditor(handle: EditorRegistryHandle | null): void {
  activeHandle = handle;
}

/** Get the active editor's state, or null if no editor is mounted. */
export function getActiveEditorState(): EditorState | null {
  return activeHandle?.getState() ?? null;
}

/** Dispatch a transaction to the active editor. No-op if none mounted. */
export function dispatchToActiveEditor(tr: Transaction): void {
  activeHandle?.dispatch(tr);
}

/** Test-only reset. */
export function resetEditorRegistry(): void {
  dynamicPlugins.clear();
  pluginListeners.clear();
  transactionListeners.clear();
  activeHandle = null;
}
