// packages/ui/src/editor/state/plugins.ts
import type { EditorState, Transaction } from "./transaction";
import type { DecorationSpec } from "./types";

export interface SuggestionTrigger {
  kind: "wikilink" | "tag" | "slash";
  /** Offset where the trigger char appeared. */
  from: number;
  /** Offset of the caret at trigger time. */
  caret: number;
  /** The raw text typed since the trigger char. */
  query: string;
}

export interface Suggestion {
  id: string;
  label: string;
  kind: "note" | "tag" | "command";
  /** The text to insert in place of [from..caret]. */
  insert: string;
}

/**
 * Result of a plugin's `onKeyDown` handler. Semantics:
 *  - `Transaction` — apply this transaction and consume the event.
 *  - `"prevent-default"` — swallow the event without dispatching anything.
 *  - `null` — pass the event on; the next plugin in registration order
 *    (then the editor's own keymap, then the browser default) gets a turn.
 */
export type KeyDownResult = Transaction | "prevent-default" | null;

export interface EditorPlugin {
  name: string;
  decorations?(state: EditorState): DecorationSpec[];
  commands?: Record<string, (state: EditorState) => Transaction>;
  suggestions?(state: EditorState, trigger: SuggestionTrigger): Promise<Suggestion[]>;
  onTransaction?(tr: Transaction, state: EditorState): Transaction | null;
  /**
   * Native keydown hook. Invoked before the editor's own keymap. Return:
   *   - a Transaction to apply and consume the event,
   *   - "prevent-default" to swallow the event with no transaction,
   *   - null to pass through to subsequent plugins / native handling.
   * The first non-null result wins; later plugins do not run.
   */
  onKeyDown?(e: KeyboardEvent, state: EditorState): KeyDownResult;
}

/** Run all plugins' decoration emitters and concat results. */
export function collectDecorations(plugins: readonly EditorPlugin[], state: EditorState): DecorationSpec[] {
  const out: DecorationSpec[] = [];
  for (const p of plugins) {
    if (p.decorations) out.push(...p.decorations(state));
  }
  return out;
}
