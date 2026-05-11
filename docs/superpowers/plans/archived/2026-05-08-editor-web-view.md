# Editor Web View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Build the in-house web/Tauri editor view — a `contenteditable`-backed React component that renders the in-house `EditorState` (with decorations + cursors) and translates `beforeinput` / composition / clipboard events back into `Transaction`s. No `@codemirror/*` imports.

**Architecture:** A single `EditorView.web.tsx` component owns a `<div contenteditable>` whose child structure is a flat sequence of `<span data-kind=…>` runs derived from `DecorationSpec[]`. Local edits are intercepted via `beforeinput` (preventing the browser from mutating the DOM) and converted into ops; the component reapplies the model by re-projecting the document. IME is handled with a deferred-transaction strategy: during `compositionstart`/`compositionupdate`, browser DOM mutation is allowed; on `compositionend`, the resulting text-delta is reconciled into a single op.

**Tech Stack:** TypeScript, React 18, vitest + Playwright (for IME smoke tests). Depends on the public barrel from `editor-state-core` and (optionally) `editor-yjs-binding`.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

**Depends on:** [`2026-05-08-editor-state-core.md`](./2026-05-08-editor-state-core.md), optionally [`2026-05-08-editor-yjs-binding.md`](./2026-05-08-editor-yjs-binding.md)

---

## File ownership

- `packages/ui/src/editor/view/web/**` (new)
- `packages/ui/src/editor/index.ts` (modify: re-export `EditorView` from a platform-resolved entry)
- `packages/ui/src/editor/view/EditorView.ts` (type-only stub, like the graph subsystem)

Not touched: `editor/state/**`, `editor/view/native/**` (separate sub-plans), `packages/client/src/components/Editor/**` (those imports change in `editor-plugin-migration`, not here).

---

## Task EW-1: Decoration → DOM-spec mapper — TDD

**Files:**
- Create: `packages/ui/src/editor/view/web/projectDom.ts`
- Create: `packages/ui/src/editor/view/web/__tests__/projectDom.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { projectDom } from "../projectDom";
import type { DecorationSpec } from "../../../state/types";

describe("projectDom", () => {
  it("emits a single text run when there are no decorations", () => {
    const runs = projectDom("hello world", []);
    expect(runs).toEqual([{ kind: null, text: "hello world", from: 0, to: 11 }]);
  });

  it("splits text around a single decoration", () => {
    const decos: DecorationSpec[] = [{ from: 6, to: 11, kind: "bold" }];
    const runs = projectDom("hello world", decos);
    expect(runs).toEqual([
      { kind: null, text: "hello ", from: 0, to: 6 },
      { kind: "bold", text: "world", from: 6, to: 11, attrs: undefined },
      { kind: null, text: "", from: 11, to: 11 },
    ].filter((r) => r.text !== ""));
  });

  it("handles overlapping decorations by emitting nested runs (outer first)", () => {
    const decos: DecorationSpec[] = [
      { from: 0, to: 11, kind: "blockquote" },
      { from: 6, to: 11, kind: "bold" },
    ];
    const runs = projectDom("hello world", decos);
    // The mapper flattens — outer decoration on the surrounding range, the
    // overlap section gets the inner kind. Only one kind per run in v1.
    expect(runs.map((r) => r.kind)).toEqual(["blockquote", "bold"]);
  });

  it("preserves wikilink target attr", () => {
    const decos: DecorationSpec[] = [{ from: 4, to: 16, kind: "wikilink", attrs: { target: "Other" } }];
    const runs = projectDom("see [[Other]]!", decos);
    const wl = runs.find((r) => r.kind === "wikilink");
    expect(wl?.attrs?.target).toBe("Other");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/projectDom`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/view/web/projectDom.ts
import type { DecorationKind, DecorationSpec } from "../../state/types";

export interface DomRun {
  kind: DecorationKind | null;
  text: string;
  from: number;
  to: number;
  attrs?: Record<string, string>;
}

/**
 * Flatten the document text + decorations into a sequence of runs, where each
 * run carries at most one DecorationKind. v1 strategy: when decorations
 * overlap, the deeper (smaller-range) decoration wins on the overlap segment.
 */
export function projectDom(text: string, decorations: readonly DecorationSpec[]): DomRun[] {
  if (decorations.length === 0) return [{ kind: null, text, from: 0, to: text.length }];
  // Build a per-offset tag of "innermost decoration" by sorting decos and
  // walking left-to-right, keeping a stack of active decos sorted by length.
  const sorted = [...decorations].sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const tag: Array<DecorationSpec | null> = new Array(text.length).fill(null);
  for (const d of sorted) {
    for (let i = d.from; i < d.to; i++) {
      // Smaller (= deeper) range wins.
      const cur = tag[i];
      if (!cur || (d.to - d.from) < (cur.to - cur.from)) tag[i] = d;
    }
  }
  const runs: DomRun[] = [];
  let i = 0;
  while (i < text.length) {
    const cur = tag[i];
    let j = i + 1;
    while (j < text.length && tag[j] === cur) j++;
    runs.push({
      kind: cur?.kind ?? null,
      text: text.slice(i, j),
      from: i,
      to: j,
      attrs: cur?.attrs,
    });
    i = j;
  }
  return runs;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/projectDom`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/view/web/projectDom.ts packages/ui/src/editor/view/web/__tests__/projectDom.test.ts
git commit -m "feat(editor/view/web): document → DOM run projection"
```

---

## Task EW-2: Selection conversion — TDD

**Files:**
- Create: `packages/ui/src/editor/view/web/selection.ts`
- Create: `packages/ui/src/editor/view/web/__tests__/selection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { domRangeToSelection, selectionToDomRange } from "../selection";

function mkRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-editor-root", "");
  // <span data-from="0" data-to="6">hello </span><span data-from="6" data-to="11">world</span>
  const a = document.createElement("span"); a.setAttribute("data-from", "0"); a.setAttribute("data-to", "6"); a.textContent = "hello ";
  const b = document.createElement("span"); b.setAttribute("data-from", "6"); b.setAttribute("data-to", "11"); b.textContent = "world";
  root.append(a, b);
  return root;
}

describe("DOM Range ↔ Selection", () => {
  it("converts caret in second span to absolute offset", () => {
    const root = mkRoot();
    document.body.appendChild(root);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(root.children[1].firstChild!, 3); // "wor|ld"
    r.collapse(true);
    sel.addRange(r);

    const out = domRangeToSelection(root);
    expect(out).toEqual({ anchor: 9, head: 9 });
  });

  it("places a DOM Range from a Selection", () => {
    const root = mkRoot();
    document.body.appendChild(root);
    selectionToDomRange(root, { anchor: 6, head: 11 });
    const sel = window.getSelection()!;
    expect(sel.toString()).toBe("world");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/selection`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/view/web/selection.ts
import type { Selection } from "../../state/types";

function offsetForNode(root: HTMLElement, node: Node, nodeOffset: number): number {
  // Walk up to the nearest <span data-from data-to>.
  let cur: Node | null = node;
  let consumed = nodeOffset;
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      const fromAttr = el.getAttribute?.("data-from");
      if (fromAttr !== null) return Number(fromAttr) + consumed;
    } else if (cur.nodeType === Node.TEXT_NODE) {
      // First step: nodeOffset is consumed; subsequent: full text length.
      if (cur === node) {
        // already counted
      } else {
        consumed += (cur.textContent ?? "").length;
      }
    }
    cur = cur.parentNode;
  }
  return 0;
}

export function domRangeToSelection(root: HTMLElement): Selection {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { anchor: 0, head: 0 };
  const r = sel.getRangeAt(0);
  const anchor = offsetForNode(root, r.startContainer, r.startOffset);
  const head = offsetForNode(root, r.endContainer, r.endOffset);
  return { anchor, head };
}

export function selectionToDomRange(root: HTMLElement, sel: Selection): void {
  const w = window.getSelection();
  if (!w) return;
  const r = document.createRange();
  const place = (offset: number, side: "start" | "end") => {
    for (const child of Array.from(root.children)) {
      const from = Number(child.getAttribute("data-from"));
      const to = Number(child.getAttribute("data-to"));
      if (offset >= from && offset <= to) {
        const text = child.firstChild ?? child;
        const local = Math.max(0, Math.min((text.textContent ?? "").length, offset - from));
        if (side === "start") r.setStart(text, local);
        else r.setEnd(text, local);
        return;
      }
    }
  };
  place(Math.min(sel.anchor, sel.head), "start");
  place(Math.max(sel.anchor, sel.head), "end");
  w.removeAllRanges();
  w.addRange(r);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/selection`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/view/web/selection.ts packages/ui/src/editor/view/web/__tests__/selection.test.ts
git commit -m "feat(editor/view/web): DOM Range ↔ Selection conversion"
```

---

## Task EW-3: beforeinput → Operation — TDD

**Files:**
- Create: `packages/ui/src/editor/view/web/beforeinput.ts`
- Create: `packages/ui/src/editor/view/web/__tests__/beforeinput.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { interpretBeforeInput } from "../beforeinput";

function mkEvent(type: string, data: string | null = null, ranges: { startOffset: number; endOffset: number }[] = []) {
  return { inputType: type, data, getTargetRanges: () => ranges } as unknown as InputEvent;
}

describe("interpretBeforeInput", () => {
  it("insertText with caret produces an insert op", () => {
    const r = interpretBeforeInput(mkEvent("insertText", "x"), { anchor: 5, head: 5 });
    expect(r).toEqual({
      ops: [{ kind: "insert", at: 5, text: "x" }],
      selection: { anchor: 6, head: 6 },
    });
  });

  it("insertText with selection produces a replace op", () => {
    const r = interpretBeforeInput(mkEvent("insertText", "x"), { anchor: 3, head: 7 });
    expect(r).toEqual({
      ops: [{ kind: "replace", from: 3, to: 7, text: "x" }],
      selection: { anchor: 4, head: 4 },
    });
  });

  it("deleteContentBackward at caret deletes one char", () => {
    const r = interpretBeforeInput(mkEvent("deleteContentBackward"), { anchor: 5, head: 5 });
    expect(r).toEqual({
      ops: [{ kind: "delete", from: 4, to: 5 }],
      selection: { anchor: 4, head: 4 },
    });
  });

  it("insertParagraph inserts a newline", () => {
    const r = interpretBeforeInput(mkEvent("insertParagraph"), { anchor: 2, head: 2 });
    expect(r).toEqual({
      ops: [{ kind: "insert", at: 2, text: "\n" }],
      selection: { anchor: 3, head: 3 },
    });
  });

  it("returns null for ignored input types", () => {
    expect(interpretBeforeInput(mkEvent("formatBold"), { anchor: 0, head: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/beforeinput`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/beforeinput`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/view/web/beforeinput.ts packages/ui/src/editor/view/web/__tests__/beforeinput.test.ts
git commit -m "feat(editor/view/web): beforeinput → Operation translator"
```

---

## Task EW-4: Paste normalisation — TDD

**Files:**
- Create: `packages/ui/src/editor/view/web/paste.ts`
- Create: `packages/ui/src/editor/view/web/__tests__/paste.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { normalizeClipboardData } from "../paste";

describe("normalizeClipboardData", () => {
  it("prefers text/plain when present", () => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "raw");
    dt.setData("text/html", "<b>raw</b>");
    expect(normalizeClipboardData(dt)).toBe("raw");
  });

  it("strips HTML tags when only text/html is available", () => {
    const dt = new DataTransfer();
    dt.setData("text/html", "<p>hello <b>world</b></p>");
    expect(normalizeClipboardData(dt)).toBe("hello world");
  });

  it("normalises CRLF to LF", () => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "a\r\nb\r\nc");
    expect(normalizeClipboardData(dt)).toBe("a\nb\nc");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/paste`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/view/web/paste.ts
export function normalizeClipboardData(dt: DataTransfer): string {
  const plain = dt.getData("text/plain");
  if (plain) return plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const html = dt.getData("text/html");
  if (html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent ?? "").replace(/\r\n/g, "\n");
  }
  return "";
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/view/web/__tests__/paste`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/view/web/paste.ts packages/ui/src/editor/view/web/__tests__/paste.test.ts
git commit -m "feat(editor/view/web): clipboard normalisation"
```

---

## Task EW-5: EditorView component

**Files:**
- Create: `packages/ui/src/editor/view/web/EditorView.web.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/editor/view/web/EditorView.web.tsx
import * as React from "react";
import {
  applyTransaction,
  createEditorState,
  createHistory,
  emitDecorations,
  transactionFromOps,
  type EditorPlugin,
  type EditorState,
  collectDecorations,
} from "../../state";
import { projectDom } from "./projectDom";
import { domRangeToSelection, selectionToDomRange } from "./selection";
import { interpretBeforeInput } from "./beforeinput";
import { normalizeClipboardData } from "./paste";

export interface EditorViewProps {
  /** Initial source text, only used on mount. */
  initialDoc?: string;
  /** Plugins contributing decorations / commands / suggestions. */
  plugins?: readonly EditorPlugin[];
  /** Called after every transaction with the new state. */
  onChange?: (state: EditorState) => void;
  /** Called when the user clicks/taps a wikilink decoration. */
  onWikilinkClick?: (target: string) => void;
  className?: string;
}

const KIND_CLASS: Record<string, string> = {
  "heading-1": "ed-h1", "heading-2": "ed-h2", "heading-3": "ed-h3",
  "heading-4": "ed-h4", "heading-5": "ed-h5", "heading-6": "ed-h6",
  bold: "ed-bold", italic: "ed-italic", strikethrough: "ed-strike",
  "code-inline": "ed-code-inline", "code-block": "ed-code-block",
  link: "ed-link", wikilink: "ed-wikilink", tag: "ed-tag",
  blockquote: "ed-blockquote", "list-item": "ed-li",
  "task-checked": "ed-task-checked", "task-unchecked": "ed-task-unchecked",
  "horizontal-rule": "ed-hr",
};

export function EditorView({
  initialDoc = "", plugins = [], onChange, onWikilinkClick, className,
}: EditorViewProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const composingRef = React.useRef(false);
  const stateRef = React.useRef<EditorState>(createEditorState(initialDoc));
  const historyRef = React.useRef(createHistory());
  const [, forceRender] = React.useReducer((n) => n + 1, 0);

  const setState = React.useCallback((next: EditorState) => {
    stateRef.current = next;
    onChange?.(next);
    forceRender();
  }, [onChange]);

  const dispatch = React.useCallback((tr: { ops: import("../../state").Operation[]; selection: import("../../state").Selection | null }) => {
    historyRef.current.record(stateRef.current, tr);
    setState(applyTransaction(stateRef.current, transactionFromOps(tr.ops, tr.selection ?? undefined)));
  }, [setState]);

  // After every render, replace selection in the DOM to match state.selection.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    selectionToDomRange(root, stateRef.current.selection);
  });

  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (composingRef.current) return; // let IME run
    e.preventDefault();
    const interpreted = interpretBeforeInput(e.nativeEvent as InputEvent, stateRef.current.selection);
    if (!interpreted) return;
    dispatch(interpreted);
  };

  const onCompositionStart = () => { composingRef.current = true; };
  const onCompositionEnd = (e: React.CompositionEvent) => {
    composingRef.current = false;
    // Reconcile: read the resulting text near the caret and produce a single
    // replace covering the composition range.
    const root = rootRef.current!;
    const liveSel = domRangeToSelection(root);
    const composed = e.data ?? "";
    const start = stateRef.current.selection.anchor;
    dispatch({
      ops: [{ kind: "replace", from: Math.min(start, liveSel.anchor), to: Math.max(start, liveSel.anchor), text: composed }],
      selection: liveSel,
    });
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = normalizeClipboardData(e.clipboardData);
    const sel = stateRef.current.selection;
    const from = Math.min(sel.anchor, sel.head);
    const to = Math.max(sel.anchor, sel.head);
    dispatch({
      ops: from === to
        ? [{ kind: "insert", at: from, text }]
        : [{ kind: "replace", from, to, text }],
      selection: { anchor: from + text.length, head: from + text.length },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const undone = historyRef.current.undo(stateRef.current);
      if (undone) setState(undone);
    } else if (meta && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      const redone = historyRef.current.redo(stateRef.current);
      if (redone) setState(redone);
    }
  };

  const onSelect = () => {
    if (composingRef.current) return;
    const root = rootRef.current!;
    const next = domRangeToSelection(root);
    if (next.anchor !== stateRef.current.selection.anchor || next.head !== stateRef.current.selection.head) {
      stateRef.current = { ...stateRef.current, selection: next };
      onChange?.(stateRef.current);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-kind="wikilink"]') as HTMLElement | null;
    if (target) {
      const wlTarget = target.getAttribute("data-target");
      if (wlTarget && onWikilinkClick) onWikilinkClick(wlTarget);
    }
  };

  const decos = [
    ...emitDecorations(stateRef.current.doc, stateRef.current.tree),
    ...collectDecorations(plugins, stateRef.current),
  ];
  const runs = projectDom(stateRef.current.doc, decos);

  return (
    <div
      ref={rootRef}
      className={className ?? "ed-root"}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBeforeInput={onBeforeInput}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      onClick={onClick}
      data-editor-root=""
    >
      {runs.map((run, i) => (
        <span
          key={i}
          data-from={run.from}
          data-to={run.to}
          data-kind={run.kind ?? undefined}
          data-target={run.attrs?.target}
          className={run.kind ? KIND_CLASS[run.kind] : undefined}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/web/EditorView.web.tsx
git commit -m "feat(editor/view/web): contenteditable EditorView with IME + paste + history"
```

---

## Task EW-6: Public barrel — platform-resolved EditorView

**Files:**
- Create: `packages/ui/src/editor/view/EditorView.ts`
- Create: `packages/ui/src/editor/index.ts`

- [ ] **Step 1: Write the type stub**

```ts
// packages/ui/src/editor/view/EditorView.ts
// Type-only stub. Bundlers resolve EditorView.web.tsx or EditorView.native.tsx
// at build time via platform extensions.
export type { EditorViewProps } from "./web/EditorView.web";
export { EditorView } from "./web/EditorView.web";
```

- [ ] **Step 2: Write the editor barrel**

```ts
// packages/ui/src/editor/index.ts
export * from "./state";
export { EditorView } from "./view/EditorView";
export type { EditorViewProps } from "./view/EditorView";
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/EditorView.ts packages/ui/src/editor/index.ts
git commit -m "feat(editor): public barrel with platform-resolved EditorView"
```

---

## Task EW-7: Playwright IME smoke tests

**Files:**
- Create: `packages/ui/playwright/editor-ime.spec.ts`
- Modify: `packages/ui/package.json` (add `@playwright/test` devDep, `test:e2e` script)

- [ ] **Step 1: Add Playwright**

```bash
cd packages/ui && npm install --save-dev @playwright/test
npx playwright install chromium
```

Add to `packages/ui/package.json` scripts:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Write the smoke tests**

```ts
// packages/ui/playwright/editor-ime.spec.ts
import { test, expect } from "@playwright/test";

// These tests require a fixture page that mounts <EditorView /> at "/test/editor".
// The fixture is set up under a separate task in the consuming app; this file
// exercises that route.

test("japanese IME composition produces a single committed insert", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "IME tests run only in Chromium");
  await page.goto("/test/editor");
  const editor = page.locator('[data-editor-root]');
  await editor.click();
  await page.keyboard.insertText("にほんご"); // skips browser IME; equivalent to commit
  await expect(editor).toHaveText("にほんご");
});

test("dead-key sequence (option-e then e) produces é", async ({ page, browserName, platform }) => {
  test.skip(browserName !== "chromium" || platform !== "darwin", "macOS dead keys");
  await page.goto("/test/editor");
  const editor = page.locator('[data-editor-root]');
  await editor.click();
  await page.keyboard.press("Alt+KeyE");
  await page.keyboard.press("KeyE");
  await expect(editor).toHaveText("é");
});

test("backspace deletes last grapheme", async ({ page }) => {
  await page.goto("/test/editor");
  const editor = page.locator('[data-editor-root]');
  await editor.click();
  await page.keyboard.insertText("hello");
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveText("hell");
});
```

- [ ] **Step 3: Document the fixture requirement**

> **Note:** these tests require a fixture route `/test/editor` mounting `<EditorView />`. That fixture is set up in `editor-plugin-migration` as part of the client wire-up. Until then, this `test:e2e` script may report "no server" — the unit-test gate for EW-1..EW-6 is sufficient for this sub-plan.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/playwright/editor-ime.spec.ts packages/ui/package.json package-lock.json
git commit -m "test(editor/view/web): Playwright IME smoke tests (run via test:e2e)"
```

---

## Task EW-8: Acceptance — unit tests pass, no CM6 imports under view/web

**Files:** none modified — verification only.

- [ ] **Step 1: Run the editor view tests**

Run: `cd packages/ui && npm test -- editor/view/web`
Expected: all PASS.

- [ ] **Step 2: Confirm no CM6 imports**

Run: `grep -rn "@codemirror" packages/ui/src/editor/view/web/`
Expected: no hits.

- [ ] **Step 3: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor/view/web): web editor surface ready; CM6 still in client until plugin-migration"
```
