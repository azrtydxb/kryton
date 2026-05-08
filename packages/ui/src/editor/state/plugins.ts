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

export interface EditorPlugin {
  name: string;
  decorations?(state: EditorState): DecorationSpec[];
  commands?: Record<string, (state: EditorState) => Transaction>;
  suggestions?(state: EditorState, trigger: SuggestionTrigger): Promise<Suggestion[]>;
  onTransaction?(tr: Transaction, state: EditorState): Transaction | null;
}

/** Run all plugins' decoration emitters and concat results. */
export function collectDecorations(plugins: readonly EditorPlugin[], state: EditorState): DecorationSpec[] {
  const out: DecorationSpec[] = [];
  for (const p of plugins) {
    if (p.decorations) out.push(...p.decorations(state));
  }
  return out;
}
