// packages/ui/src/editor/state/types.ts
import type { Tree } from "@lezer/common";

/** A character offset into the document text. */
export type Offset = number;

/** Inclusive-start, exclusive-end range. anchor==head means caret. */
export interface Selection {
  anchor: Offset;
  head: Offset;
}

export type DecorationKind =
  | "heading-1" | "heading-2" | "heading-3" | "heading-4" | "heading-5" | "heading-6"
  | "bold" | "italic" | "strikethrough" | "code-inline" | "code-block"
  | "link" | "wikilink" | "tag" | "blockquote" | "list-item" | "task-checked" | "task-unchecked"
  | "horizontal-rule";

export interface DecorationSpec {
  from: Offset;
  to: Offset;
  kind: DecorationKind;
  attrs?: Record<string, string>;
}

export interface EditorStateSnapshot {
  doc: string;
  selection: Selection;
  /** Lezer parse tree for `doc`. Cached; recomputed only when text changes. */
  tree: Tree;
}
