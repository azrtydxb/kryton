// packages/ui/src/editor/state/transaction.ts
import type { Tree } from "@lezer/common";
import { createDocument, type Document } from "./document";
import { applyOps, type Operation } from "./operations";
import { createParser, type MarkdownParser } from "./parser";
import type { Selection, EditorStateSnapshot } from "./types";

export interface EditorState {
  readonly doc: string;
  readonly selection: Selection;
  readonly tree: Tree;
  /** Internal: the Document handle (rope-backed in future; string today). */
  readonly _document: Document;
  /** Internal: shared parser instance. */
  readonly _parser: MarkdownParser;
}

export interface Transaction {
  ops: readonly Operation[];
  selection: Selection | null;
}

export function transactionFromOps(ops: readonly Operation[], selection?: Selection): Transaction {
  return { ops, selection: selection ?? null };
}

export function createEditorState(initial: string, selection: Selection = { anchor: 0, head: 0 }): EditorState {
  const _document = createDocument(initial);
  const _parser = createParser();
  const tree = _parser.parse(initial);
  return { doc: initial, selection, tree, _document, _parser };
}

export function applyTransaction(state: EditorState, tr: Transaction): EditorState {
  const nextDoc = applyOps(state._document, tr.ops);
  const nextTree = state._parser.parseIncremental(nextDoc.text, state.tree);
  const nextSelection = tr.selection ?? state.selection;
  return {
    doc: nextDoc.text,
    selection: nextSelection,
    tree: nextTree,
    _document: nextDoc,
    _parser: state._parser,
  };
}

export function snapshot(state: EditorState): EditorStateSnapshot {
  return { doc: state.doc, selection: state.selection, tree: state.tree };
}
