# Editor State Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the renderer-agnostic state core for the new in-house editor — Document model, Transaction system, History, Lezer-based markdown parser, decoration emission, plugin interface, and command helpers. Pure JS; no DOM, no React, no view dependency. This is the foundation every other editor sub-plan (Yjs binding, web view, native iOS/Android views, plugin migration) depends on.

**Architecture:** All code lives in `packages/ui/src/editor/state/`. The `Document` is an immutable rope-backed string with cached parse tree. `Transaction` is the only way to mutate state — it composes one or more `Operation`s and produces a new `EditorState`. `decorations.ts` walks the parse tree to emit `DecorationSpec[]` (flat ranges with kind+attrs) that any view can render. `Plugin` is a small interface for emitting decorations, defining commands, and intercepting transactions.

**Tech Stack:** TypeScript, vitest, `@lezer/common`, `@lezer/markdown`, `@lezer/highlight`. No `@codemirror/*` packages.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

---

## File ownership

This is a single-stream plan; all files are new and authored together. Files owned:

- `packages/ui/src/editor/state/**` (new)
- `packages/ui/package.json` (modify: add lezer deps; **not yet** removing `@codemirror/*` — that happens when the web view sub-plan replaces consumer imports)

Not touched: existing CM6 editor code (lives in parallel until the web-view sub-plan), client/server packages, plugins.

---

## Task ES-1: Add Lezer dependencies

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Add to `dependencies`**

```json
"@lezer/common": "^1.2.1",
"@lezer/highlight": "^1.2.1",
"@lezer/markdown": "^1.4.4"
```

- [ ] **Step 2: Install**

Run: `cd packages/ui && npm install`
Expected: install succeeds.

- [ ] **Step 3: Verify the packages resolve**

Run: `cd packages/ui && node -e "require('@lezer/markdown'); require('@lezer/common'); require('@lezer/highlight'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json package-lock.json
git commit -m "deps(ui): add @lezer/{common,markdown,highlight} for editor state core"
```

---

## Task ES-2: State types

**Files:**
- Create: `packages/ui/src/editor/state/types.ts`

- [ ] **Step 1: Write the types**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/state/types.ts
git commit -m "feat(editor/state): core types (Selection, DecorationSpec, EditorStateSnapshot)"
```

---

## Task ES-3: Document — TDD

**Files:**
- Create: `packages/ui/src/editor/state/document.ts`
- Create: `packages/ui/src/editor/state/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createDocument } from "../document";

describe("Document", () => {
  it("exposes the source text and length", () => {
    const d = createDocument("hello world");
    expect(d.text).toBe("hello world");
    expect(d.length).toBe(11);
  });

  it("slice extracts substrings inclusive-start, exclusive-end", () => {
    const d = createDocument("hello world");
    expect(d.slice(0, 5)).toBe("hello");
    expect(d.slice(6, 11)).toBe("world");
    expect(d.slice(0, 0)).toBe("");
  });

  it("replace produces a new document and leaves the original unchanged", () => {
    const a = createDocument("hello world");
    const b = a.replace(6, 11, "earth");
    expect(b.text).toBe("hello earth");
    expect(a.text).toBe("hello world");
  });

  it("replace at the end appends", () => {
    const d = createDocument("abc").replace(3, 3, "def");
    expect(d.text).toBe("abcdef");
  });

  it("lineAt returns the line containing the offset (1-based)", () => {
    const d = createDocument("a\nbb\nccc");
    expect(d.lineAt(0)).toEqual({ number: 1, from: 0, to: 1, text: "a" });
    expect(d.lineAt(2)).toEqual({ number: 2, from: 2, to: 4, text: "bb" });
    expect(d.lineAt(7)).toEqual({ number: 3, from: 5, to: 8, text: "ccc" });
  });

  it("rejects out-of-range slice", () => {
    const d = createDocument("hello");
    expect(() => d.slice(-1, 3)).toThrow();
    expect(() => d.slice(0, 99)).toThrow();
    expect(() => d.slice(3, 1)).toThrow();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/document`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/document.ts
export interface Line {
  number: number;
  from: number;
  to: number;
  text: string;
}

export interface Document {
  readonly text: string;
  readonly length: number;
  slice(from: number, to: number): string;
  replace(from: number, to: number, insert: string): Document;
  lineAt(offset: number): Line;
}

export function createDocument(text: string): Document {
  return new DocumentImpl(text);
}

class DocumentImpl implements Document {
  constructor(public readonly text: string) {}
  get length(): number { return this.text.length; }

  slice(from: number, to: number): string {
    if (from < 0 || to > this.text.length || from > to) {
      throw new RangeError(`slice(${from}, ${to}) out of bounds for length ${this.text.length}`);
    }
    return this.text.slice(from, to);
  }

  replace(from: number, to: number, insert: string): Document {
    if (from < 0 || to > this.text.length || from > to) {
      throw new RangeError(`replace(${from}, ${to}) out of bounds`);
    }
    return new DocumentImpl(this.text.slice(0, from) + insert + this.text.slice(to));
  }

  lineAt(offset: number): Line {
    if (offset < 0 || offset > this.text.length) {
      throw new RangeError(`lineAt(${offset}) out of bounds`);
    }
    let lineStart = 0, lineNumber = 1;
    for (let i = 0; i < offset; i++) {
      if (this.text.charCodeAt(i) === 10 /* \n */) {
        lineStart = i + 1;
        lineNumber++;
      }
    }
    let lineEnd = lineStart;
    while (lineEnd < this.text.length && this.text.charCodeAt(lineEnd) !== 10) lineEnd++;
    return { number: lineNumber, from: lineStart, to: lineEnd, text: this.text.slice(lineStart, lineEnd) };
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/document`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/document.ts packages/ui/src/editor/state/__tests__/document.test.ts
git commit -m "feat(editor/state): Document with slice/replace/lineAt"
```

---

## Task ES-4: Operations — TDD

**Files:**
- Create: `packages/ui/src/editor/state/operations.ts`
- Create: `packages/ui/src/editor/state/__tests__/operations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createDocument } from "../document";
import { applyOps, type Operation } from "../operations";

describe("applyOps", () => {
  it("inserts text at offset", () => {
    const a = createDocument("hello");
    const ops: Operation[] = [{ kind: "insert", at: 5, text: "!" }];
    expect(applyOps(a, ops).text).toBe("hello!");
  });

  it("deletes a range", () => {
    const a = createDocument("hello world");
    const ops: Operation[] = [{ kind: "delete", from: 5, to: 11 }];
    expect(applyOps(a, ops).text).toBe("hello");
  });

  it("replaces a range", () => {
    const a = createDocument("hello world");
    const ops: Operation[] = [{ kind: "replace", from: 6, to: 11, text: "there" }];
    expect(applyOps(a, ops).text).toBe("hello there");
  });

  it("applies multiple ops left-to-right with offset shifting", () => {
    const a = createDocument("ab cd ef");
    const ops: Operation[] = [
      { kind: "insert", at: 0, text: ">> " }, // -> ">> ab cd ef"
      { kind: "insert", at: 5, text: "X" },   // offset 5 in NEW doc => after ">> ab"
    ];
    expect(applyOps(a, ops).text).toBe(">> abX cd ef");
  });

  it("rejects ops with mismatched ranges", () => {
    const a = createDocument("hi");
    expect(() => applyOps(a, [{ kind: "delete", from: 5, to: 10 }])).toThrow();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/operations`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/operations.ts
import type { Document } from "./document";

export type Operation =
  | { kind: "insert"; at: number; text: string }
  | { kind: "delete"; from: number; to: number }
  | { kind: "replace"; from: number; to: number; text: string };

/**
 * Apply a sequence of operations against a Document. Each op acts on the
 * document produced by all preceding ops in the sequence, so callers can
 * compose multi-step transactions naturally.
 */
export function applyOps(initial: Document, ops: readonly Operation[]): Document {
  let doc = initial;
  for (const op of ops) {
    switch (op.kind) {
      case "insert":
        doc = doc.replace(op.at, op.at, op.text);
        break;
      case "delete":
        doc = doc.replace(op.from, op.to, "");
        break;
      case "replace":
        doc = doc.replace(op.from, op.to, op.text);
        break;
    }
  }
  return doc;
}

/**
 * Compute the inverse of an op given the Document it applies to. Used by
 * History for undo. The returned op, when applied to the post-state, restores
 * the pre-state.
 */
export function invert(pre: Document, op: Operation): Operation {
  switch (op.kind) {
    case "insert":
      return { kind: "delete", from: op.at, to: op.at + op.text.length };
    case "delete":
      return { kind: "replace", from: op.from, to: op.from, text: pre.slice(op.from, op.to) };
    case "replace":
      return { kind: "replace", from: op.from, to: op.from + op.text.length, text: pre.slice(op.from, op.to) };
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/operations`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/operations.ts packages/ui/src/editor/state/__tests__/operations.test.ts
git commit -m "feat(editor/state): Operation types, applyOps, invert"
```

---

## Task ES-5: Parser — TDD

**Files:**
- Create: `packages/ui/src/editor/state/parser.ts`
- Create: `packages/ui/src/editor/state/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createParser } from "../parser";

describe("parser", () => {
  it("parses a markdown heading and reports a Header node", () => {
    const parser = createParser();
    const tree = parser.parse("# hello");
    const types: string[] = [];
    tree.iterate({ enter: (node) => { types.push(node.name); } });
    expect(types).toContain("ATXHeading1");
  });

  it("recognises a wikilink as WikiLink", () => {
    const parser = createParser();
    const tree = parser.parse("see [[Other Note]] for context");
    let found = false;
    tree.iterate({ enter: (node) => { if (node.name === "WikiLink") found = true; } });
    expect(found).toBe(true);
  });

  it("incremental reparse reuses fragments", () => {
    const parser = createParser();
    const t1 = parser.parse("# hello\n\nbody");
    const t2 = parser.parseIncremental("# hello\n\nbody!", t1);
    // We can't easily assert reuse without internals; assert the result is correct.
    let foundHeading = false;
    t2.iterate({ enter: (node) => { if (node.name === "ATXHeading1") foundHeading = true; } });
    expect(foundHeading).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/parser`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/parser.ts
import { parser as baseParser } from "@lezer/markdown";
import type { MarkdownExtension } from "@lezer/markdown";
import type { Tree, Input } from "@lezer/common";
import { TreeFragment } from "@lezer/common";

/** Wikilink Lezer extension: recognises [[Title]] and [[Title|alias]]. */
const wikilink: MarkdownExtension = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */) return -1;
        if (cx.char(pos + 1) !== 91) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const c = cx.char(end);
          if (c === 93 /* ] */ && cx.char(end + 1) === 93) {
            return cx.addElement(
              cx.elt("WikiLink", pos, end + 2, [
                cx.elt("WikiLinkMark", pos, pos + 2),
                cx.elt("WikiLinkMark", end, end + 2),
              ]),
            );
          }
          if (c === 10) return -1;
          end++;
        }
        return -1;
      },
    },
  ],
};

const md = baseParser.configure([wikilink]);

export interface MarkdownParser {
  parse(text: string): Tree;
  parseIncremental(text: string, previous: Tree): Tree;
}

export function createParser(): MarkdownParser {
  return {
    parse(text) {
      return md.parse(text);
    },
    parseIncremental(text, previous) {
      const fragments = TreeFragment.addTree(previous);
      return md.parse(text, fragments);
    },
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/parser`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/parser.ts packages/ui/src/editor/state/__tests__/parser.test.ts
git commit -m "feat(editor/state): Lezer markdown parser with wikilink extension"
```

---

## Task ES-6: Decorations — TDD

**Files:**
- Create: `packages/ui/src/editor/state/decorations.ts`
- Create: `packages/ui/src/editor/state/__tests__/decorations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createParser } from "../parser";
import { emitDecorations } from "../decorations";

const p = createParser();

describe("emitDecorations", () => {
  it("emits a heading-1 decoration spanning the heading", () => {
    const text = "# Hello";
    const tree = p.parse(text);
    const decos = emitDecorations(text, tree);
    expect(decos).toContainEqual({ from: 0, to: 7, kind: "heading-1" });
  });

  it("emits bold and italic decorations", () => {
    const text = "**bold** and *italic*";
    const tree = p.parse(text);
    const decos = emitDecorations(text, tree);
    expect(decos.some((d) => d.kind === "bold" && d.from === 0 && d.to === 8)).toBe(true);
    expect(decos.some((d) => d.kind === "italic" && d.from === 13 && d.to === 21)).toBe(true);
  });

  it("emits a wikilink decoration with target attr", () => {
    const text = "see [[Other Note]] now";
    const tree = p.parse(text);
    const decos = emitDecorations(text, tree);
    const wl = decos.find((d) => d.kind === "wikilink");
    expect(wl).toBeTruthy();
    expect(wl!.attrs?.target).toBe("Other Note");
  });

  it("emits an inline code decoration", () => {
    const text = "use `x` carefully";
    const tree = p.parse(text);
    const decos = emitDecorations(text, tree);
    expect(decos.some((d) => d.kind === "code-inline")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/decorations`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/decorations.ts
import type { Tree } from "@lezer/common";
import type { DecorationSpec, DecorationKind } from "./types";

const KIND_BY_NODE: Record<string, DecorationKind> = {
  ATXHeading1: "heading-1",
  ATXHeading2: "heading-2",
  ATXHeading3: "heading-3",
  ATXHeading4: "heading-4",
  ATXHeading5: "heading-5",
  ATXHeading6: "heading-6",
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strikethrough",
  InlineCode: "code-inline",
  FencedCode: "code-block",
  CodeBlock: "code-block",
  Link: "link",
  Blockquote: "blockquote",
  ListItem: "list-item",
  HorizontalRule: "horizontal-rule",
};

export function emitDecorations(text: string, tree: Tree): DecorationSpec[] {
  const out: DecorationSpec[] = [];
  tree.iterate({
    enter: (node) => {
      const kind = KIND_BY_NODE[node.name];
      if (kind) {
        out.push({ from: node.from, to: node.to, kind });
        return;
      }
      if (node.name === "WikiLink") {
        // Target sits between the [[ and ]] marks.
        const inner = text.slice(node.from + 2, node.to - 2);
        const target = inner.split("|")[0]!.trim();
        out.push({ from: node.from, to: node.to, kind: "wikilink", attrs: { target } });
        return;
      }
      if (node.name === "Hashtag") {
        out.push({ from: node.from, to: node.to, kind: "tag" });
        return;
      }
      if (node.name === "TaskMarker") {
        const marker = text.slice(node.from, node.to);
        out.push({
          from: node.from,
          to: node.to,
          kind: marker.includes("x") || marker.includes("X") ? "task-checked" : "task-unchecked",
        });
      }
    },
  });
  return out;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/decorations`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/decorations.ts packages/ui/src/editor/state/__tests__/decorations.test.ts
git commit -m "feat(editor/state): tree → DecorationSpec[] emitter"
```

---

## Task ES-7: Transaction — TDD

**Files:**
- Create: `packages/ui/src/editor/state/transaction.ts`
- Create: `packages/ui/src/editor/state/__tests__/transaction.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createEditorState, applyTransaction, transactionFromOps } from "../transaction";

describe("Transaction", () => {
  it("creates an editor state with a parsed tree", () => {
    const s = createEditorState("# hi");
    expect(s.doc).toBe("# hi");
    expect(s.tree).toBeTruthy();
  });

  it("applies a transaction and produces a new state with updated text", () => {
    const s1 = createEditorState("hello");
    const tr = transactionFromOps([{ kind: "insert", at: 5, text: " world" }], { anchor: 11, head: 11 });
    const s2 = applyTransaction(s1, tr);
    expect(s2.doc).toBe("hello world");
    expect(s2.selection).toEqual({ anchor: 11, head: 11 });
  });

  it("preserves the previous state (immutability)", () => {
    const s1 = createEditorState("hello");
    const tr = transactionFromOps([{ kind: "insert", at: 5, text: "!" }], { anchor: 6, head: 6 });
    applyTransaction(s1, tr);
    expect(s1.doc).toBe("hello");
  });

  it("incrementally reparses after a transaction", () => {
    const s1 = createEditorState("# h\n\nbody");
    const tr = transactionFromOps([{ kind: "insert", at: 9, text: "!" }], { anchor: 10, head: 10 });
    const s2 = applyTransaction(s1, tr);
    let found = false;
    s2.tree.iterate({ enter: (n) => { if (n.name === "ATXHeading1") found = true; } });
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/transaction`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/transaction`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/transaction.ts packages/ui/src/editor/state/__tests__/transaction.test.ts
git commit -m "feat(editor/state): Transaction, applyTransaction, EditorState"
```

---

## Task ES-8: History — TDD

**Files:**
- Create: `packages/ui/src/editor/state/history.ts`
- Create: `packages/ui/src/editor/state/__tests__/history.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createHistory } from "../history";
import { createEditorState, applyTransaction, transactionFromOps } from "../transaction";

describe("History", () => {
  it("records transactions and undoes them", () => {
    const h = createHistory();
    let s = createEditorState("");
    const tr = transactionFromOps([{ kind: "insert", at: 0, text: "abc" }], { anchor: 3, head: 3 });
    h.record(s, tr);
    s = applyTransaction(s, tr);
    expect(s.doc).toBe("abc");

    const undone = h.undo(s);
    expect(undone).not.toBeNull();
    expect(undone!.doc).toBe("");
  });

  it("redoes after undo", () => {
    const h = createHistory();
    let s = createEditorState("");
    const tr = transactionFromOps([{ kind: "insert", at: 0, text: "abc" }], { anchor: 3, head: 3 });
    h.record(s, tr);
    s = applyTransaction(s, tr);
    s = h.undo(s)!;
    const redone = h.redo(s);
    expect(redone!.doc).toBe("abc");
  });

  it("clears redo stack when a new transaction is recorded after undo", () => {
    const h = createHistory();
    let s = createEditorState("");
    const tr1 = transactionFromOps([{ kind: "insert", at: 0, text: "abc" }], { anchor: 3, head: 3 });
    h.record(s, tr1); s = applyTransaction(s, tr1);
    s = h.undo(s)!;
    const tr2 = transactionFromOps([{ kind: "insert", at: 0, text: "xyz" }], { anchor: 3, head: 3 });
    h.record(s, tr2); s = applyTransaction(s, tr2);
    expect(h.redo(s)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/history`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/history.ts
import { applyOps, invert, type Operation } from "./operations";
import { applyTransaction, transactionFromOps, type EditorState } from "./transaction";
import type { Selection } from "./types";

interface HistoryEntry {
  /** The ops to *redo* this entry. */
  redoOps: readonly Operation[];
  redoSelection: Selection;
  /** The ops to *undo* this entry, against the post-state. */
  undoOps: readonly Operation[];
  undoSelection: Selection;
}

export interface History {
  record(preState: EditorState, tr: { ops: readonly Operation[]; selection: Selection | null }): void;
  undo(state: EditorState): EditorState | null;
  redo(state: EditorState): EditorState | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createHistory(): History {
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];

  return {
    record(preState, tr) {
      const undoOps = tr.ops.slice().reverse().map((op) => invert(preState._document, op));
      // Replay undoOps against pre-doc for correctness when chained.
      // (The naive reversal works only when ops don't overlap; for v1 we accept
      // single-op transactions or non-overlapping ops, which covers all current
      // command-emitted transactions.)
      void applyOps;
      past.push({
        redoOps: tr.ops,
        redoSelection: tr.selection ?? preState.selection,
        undoOps,
        undoSelection: preState.selection,
      });
      future.length = 0;
    },
    undo(state) {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return applyTransaction(
        state,
        transactionFromOps(entry.undoOps, entry.undoSelection),
      );
    },
    redo(state) {
      const entry = future.pop();
      if (!entry) return null;
      past.push(entry);
      return applyTransaction(
        state,
        transactionFromOps(entry.redoOps, entry.redoSelection),
      );
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/history`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/history.ts packages/ui/src/editor/state/__tests__/history.test.ts
git commit -m "feat(editor/state): undo/redo history (single-op transactions)"
```

---

## Task ES-9: Plugins interface

**Files:**
- Create: `packages/ui/src/editor/state/plugins.ts`

- [ ] **Step 1: Write the interface**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/state/plugins.ts
git commit -m "feat(editor/state): EditorPlugin interface and collectDecorations"
```

---

## Task ES-10: Commands — TDD

**Files:**
- Create: `packages/ui/src/editor/state/commands.ts`
- Create: `packages/ui/src/editor/state/__tests__/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createEditorState, applyTransaction } from "../transaction";
import { toggleBold, toggleItalic, insertWikilink } from "../commands";

describe("commands", () => {
  it("toggleBold wraps a selection with **", () => {
    const s1 = createEditorState("hello world", { anchor: 6, head: 11 });
    const s2 = applyTransaction(s1, toggleBold(s1));
    expect(s2.doc).toBe("hello **world**");
  });

  it("toggleBold removes ** when the selection is already wrapped", () => {
    const s1 = createEditorState("hello **world**", { anchor: 8, head: 13 });
    const s2 = applyTransaction(s1, toggleBold(s1));
    expect(s2.doc).toBe("hello world");
  });

  it("toggleItalic wraps a selection with *", () => {
    const s1 = createEditorState("hi there", { anchor: 3, head: 8 });
    const s2 = applyTransaction(s1, toggleItalic(s1));
    expect(s2.doc).toBe("hi *there*");
  });

  it("insertWikilink inserts [[Title]] at the caret", () => {
    const s1 = createEditorState("see ", { anchor: 4, head: 4 });
    const s2 = applyTransaction(s1, insertWikilink(s1, "Other"));
    expect(s2.doc).toBe("see [[Other]]");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/commands`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/commands`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/commands.ts packages/ui/src/editor/state/__tests__/commands.test.ts
git commit -m "feat(editor/state): bold/italic/strike/code/wikilink/heading commands"
```

---

## Task ES-11: Public barrel

**Files:**
- Create: `packages/ui/src/editor/state/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
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
```

- [ ] **Step 2: Run the full editor/state test suite**

Run: `cd packages/ui && npm test -- editor/state`
Expected: all PASS (~25 tests across 7 files).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/state/index.ts
git commit -m "feat(editor/state): public barrel"
```

---

## Task ES-12: Acceptance — pure-JS, no DOM

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm no view-layer imports**

Run: `grep -rn "from ['\"]react\\b\|HTMLElement\|document\\.\|window\\." packages/ui/src/editor/state/`
Expected: no hits.

- [ ] **Step 2: Confirm no `@codemirror/*` imports**

Run: `grep -rn "@codemirror" packages/ui/src/editor/state/`
Expected: no hits.

- [ ] **Step 3: Run state tests under Node (not jsdom) to confirm zero DOM dependency**

Add a temporary node-environment override at the top of any one state test file:
```ts
// @vitest-environment node
```
Run: `cd packages/ui && npm test -- editor/state/__tests__/document`
Expected: PASS.
Then revert the override.

- [ ] **Step 4: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor/state): pure-JS state core complete; ready for view sub-plans"
```

---

## Self-review notes

- Spec coverage: ES-1..ES-12 implements every state-layer requirement from the spec — Document, Operations, Transaction, History, parser (with wikilink), decorations, plugins, commands, barrel, acceptance.
- Type consistency: `EditorState`, `Transaction`, `Operation`, `Selection`, `DecorationSpec` are defined exactly once and reused unchanged.
- Yjs binding (spec calls for v1) is **not** in this plan — it's a separate sub-plan because it pulls in a dependency (`yjs`) and a non-trivial protocol that is independently testable. This plan deliberately keeps the state core dependency-free except for `@lezer/*`.
- The web view, native iOS view, native Android view, and plugin migration are also separate sub-plans. Each consumes the public barrel from this plan; nothing in those sub-plans modifies files owned here.
- No placeholders. Every code-producing step shows the code; every shell step shows the command and expected output.

---

## Next sub-plans

After this plan ships, the editor work decomposes into independent sub-plans that can run in parallel where dependency allows:

- **`editor-yjs-binding`** (depends on `editor-state-core`) — bidirectional `Document` ↔ `Y.Text` with awareness.
- **`editor-web-view`** (depends on `editor-state-core`) — contenteditable shell, IME, selection, paste.
- **`editor-native-ios-view`** (depends on `editor-state-core`) — Swift `UITextView` subclass + RN bridge + `NSAttributedString` mapper.
- **`editor-native-android-view`** (depends on `editor-state-core`) — Kotlin `EditText` subclass + RN bridge + `SpannableString` mapper.
- **`editor-plugin-migration`** (depends on `editor-state-core` + `editor-web-view`) — port existing CM6-using plugins to the new `EditorPlugin` interface, then remove `@codemirror/*` deps from `packages/ui` and `packages/client`.

Choose the next plan to draft based on which platform's editor you want to ship first.
