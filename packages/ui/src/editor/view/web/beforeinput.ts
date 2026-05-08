// packages/ui/src/editor/view/web/beforeinput.ts
import type { Operation } from "../../state/operations";
import type { Selection } from "../../state/types";

export interface InterpretedInput {
  ops: Operation[];
  selection: Selection;
}

export function interpretBeforeInput(e: InputEvent, sel: Selection): InterpretedInput | null {
  const from = Math.min(sel.anchor, sel.head);
  const to = Math.max(sel.anchor, sel.head);
  switch (e.inputType) {
    case "insertText": {
      const text = e.data ?? "";
      if (from === to) {
        return { ops: [{ kind: "insert", at: from, text }], selection: { anchor: from + text.length, head: from + text.length } };
      }
      return { ops: [{ kind: "replace", from, to, text }], selection: { anchor: from + text.length, head: from + text.length } };
    }
    case "insertParagraph":
    case "insertLineBreak": {
      if (from === to) {
        return { ops: [{ kind: "insert", at: from, text: "\n" }], selection: { anchor: from + 1, head: from + 1 } };
      }
      return { ops: [{ kind: "replace", from, to, text: "\n" }], selection: { anchor: from + 1, head: from + 1 } };
    }
    case "deleteContentBackward": {
      if (from === to) {
        if (from === 0) return { ops: [], selection: sel };
        return { ops: [{ kind: "delete", from: from - 1, to: from }], selection: { anchor: from - 1, head: from - 1 } };
      }
      return { ops: [{ kind: "delete", from, to }], selection: { anchor: from, head: from } };
    }
    case "deleteContentForward": {
      if (from === to) return { ops: [{ kind: "delete", from, to: from + 1 }], selection: { anchor: from, head: from } };
      return { ops: [{ kind: "delete", from, to }], selection: { anchor: from, head: from } };
    }
    case "deleteWordBackward":
    case "deleteWordForward":
    case "deleteSoftLineBackward":
    case "deleteSoftLineForward":
      // The browser computes the range; honour `getTargetRanges()`.
      return null; // handled by EditorView via target-range path
    case "insertFromPaste":
    case "insertFromDrop":
      return null; // handled by paste.ts
    default:
      return null;
  }
}
