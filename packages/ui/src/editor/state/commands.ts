// packages/ui/src/editor/state/commands.ts
import type { EditorState, Transaction } from "./transaction";
import { transactionFromOps } from "./transaction";

function range(state: EditorState): { from: number; to: number } {
  const from = Math.min(state.selection.anchor, state.selection.head);
  const to = Math.max(state.selection.anchor, state.selection.head);
  return { from, to };
}

function toggleWrap(state: EditorState, marker: string): Transaction {
  const { from, to } = range(state);
  const before = state.doc.slice(Math.max(0, from - marker.length), from);
  const after = state.doc.slice(to, to + marker.length);
  if (before === marker && after === marker) {
    // Already wrapped — strip the markers.
    return transactionFromOps(
      [
        { kind: "delete", from: to, to: to + marker.length },
        { kind: "delete", from: from - marker.length, to: from },
      ],
      { anchor: from - marker.length, head: to - marker.length },
    );
  }
  // Wrap.
  return transactionFromOps(
    [
      { kind: "insert", at: to, text: marker },
      { kind: "insert", at: from, text: marker },
    ],
    { anchor: from + marker.length, head: to + marker.length },
  );
}

export function toggleBold(state: EditorState): Transaction { return toggleWrap(state, "**"); }
export function toggleItalic(state: EditorState): Transaction { return toggleWrap(state, "*"); }
export function toggleStrikethrough(state: EditorState): Transaction { return toggleWrap(state, "~~"); }
export function toggleInlineCode(state: EditorState): Transaction { return toggleWrap(state, "`"); }

export function insertWikilink(state: EditorState, title: string): Transaction {
  const { from, to } = range(state);
  const text = `[[${title}]]`;
  return transactionFromOps(
    [{ kind: "replace", from, to, text }],
    { anchor: from + text.length, head: from + text.length },
  );
}

export function insertHeading(state: EditorState, level: 1 | 2 | 3 | 4 | 5 | 6): Transaction {
  const lineStart = state.doc.lastIndexOf("\n", state.selection.head - 1) + 1;
  const prefix = "#".repeat(level) + " ";
  return transactionFromOps(
    [{ kind: "insert", at: lineStart, text: prefix }],
    { anchor: state.selection.anchor + prefix.length, head: state.selection.head + prefix.length },
  );
}
