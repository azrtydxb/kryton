// packages/ui/src/editor/state/index.ts
export type {
  Offset, Selection, DecorationKind, DecorationSpec, EditorStateSnapshot,
} from "./types";
export type { Document, Line } from "./document";
export type { Operation } from "./operations";
export type { EditorState, Transaction } from "./transaction";
export type { History } from "./history";
export type { EditorPlugin, SuggestionTrigger, Suggestion } from "./plugins";
export type { MarkdownParser } from "./parser";

export { createDocument } from "./document";
export { applyOps, invert } from "./operations";
export { createParser } from "./parser";
export { emitDecorations } from "./decorations";
export { createEditorState, applyTransaction, transactionFromOps, snapshot } from "./transaction";
export { createHistory } from "./history";
export { collectDecorations } from "./plugins";
export {
  toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode,
  insertWikilink, insertHeading,
} from "./commands";

export type { YjsBinding } from "./yjsBinding";
export { createYjsBinding } from "./yjsBinding";
export type { CursorAwareness, RemoteCursor } from "./awareness";
export { createCursorAwareness } from "./awareness";
