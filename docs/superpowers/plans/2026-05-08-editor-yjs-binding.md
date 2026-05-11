# Editor Yjs Binding — Implementation Plan

**Status**: Implemented

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Bidirectional binding between the in-house `EditorState` (from `editor-state-core`) and a `Y.Text` document, including cursor awareness. Replaces `y-codemirror.next` with a renderer-agnostic implementation tested under Node.

**Architecture:** A single `createYjsBinding(state, ydoc, fieldKey)` factory wires `Y.Text` ops into `Transaction`s and vice versa. Local transactions translate to insert/delete on `Y.Text`; remote `Y.Text` events translate to ops applied via `applyTransaction`. Awareness keeps a per-client `{anchor, head}` cursor in `awareness.localState.cursor` and exposes a stream of remote cursor positions.

**Tech Stack:** TypeScript, vitest, `yjs`, `y-protocols/awareness`. Depends on the public barrel from `editor-state-core`.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

**Depends on:** [`2026-05-08-editor-state-core.md`](./2026-05-08-editor-state-core.md)

---

## File ownership

- `packages/ui/src/editor/state/yjsBinding.ts` (new)
- `packages/ui/src/editor/state/__tests__/yjsBinding.test.ts` (new)
- `packages/ui/src/editor/state/index.ts` (modify: re-export `createYjsBinding`)

Not touched: any view code (none exists yet); state files outside this binding.

---

## Task EY-1: Yjs binding — TDD

**Files:**
- Create: `packages/ui/src/editor/state/yjsBinding.ts`
- Create: `packages/ui/src/editor/state/__tests__/yjsBinding.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createEditorState } from "../transaction";
import { createYjsBinding } from "../yjsBinding";

describe("yjs binding", () => {
  it("local insert is reflected into Y.Text", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("body");
    let state = createEditorState("");
    const binding = createYjsBinding(ytext, () => state, (s) => { state = s; });

    binding.applyLocal({ ops: [{ kind: "insert", at: 0, text: "hello" }], selection: { anchor: 5, head: 5 } });
    expect(ytext.toString()).toBe("hello");
    expect(state.doc).toBe("hello");
    binding.dispose();
  });

  it("remote Y.Text op is reflected into a Transaction on local state", () => {
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText("body");
    let state1 = createEditorState("");
    const binding1 = createYjsBinding(ytext1, () => state1, (s) => { state1 = s; });

    const ydoc2 = new Y.Doc();
    const ytext2 = ydoc2.getText("body");
    let state2 = createEditorState("");
    const binding2 = createYjsBinding(ytext2, () => state2, (s) => { state2 = s; });

    // Wire two docs together via update messages.
    ydoc1.on("update", (u) => Y.applyUpdate(ydoc2, u));
    ydoc2.on("update", (u) => Y.applyUpdate(ydoc1, u));

    binding1.applyLocal({ ops: [{ kind: "insert", at: 0, text: "from-1" }], selection: { anchor: 6, head: 6 } });
    expect(state2.doc).toBe("from-1");

    binding2.applyLocal({ ops: [{ kind: "insert", at: 6, text: "/2" }], selection: { anchor: 8, head: 8 } });
    expect(state1.doc).toBe("from-1/2");

    binding1.dispose();
    binding2.dispose();
  });

  it("offsets shift correctly when a remote insert lands before the local caret", () => {
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText("body");
    let state1 = createEditorState("hello", { anchor: 5, head: 5 });
    const binding1 = createYjsBinding(ytext1, () => state1, (s) => { state1 = s; });
    ytext1.insert(0, "[1]"); // simulate a remote applyUpdate path

    expect(state1.doc).toBe("[1]hello");
    expect(state1.selection).toEqual({ anchor: 8, head: 8 });
    binding1.dispose();
  });

  it("dispose unsubscribes Y.Text observer", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("body");
    let state = createEditorState("");
    const binding = createYjsBinding(ytext, () => state, (s) => { state = s; });
    binding.dispose();
    ytext.insert(0, "ignored");
    expect(state.doc).toBe(""); // observer was removed before insert
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/yjsBinding`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/yjsBinding.ts
import * as Y from "yjs";
import { applyTransaction, transactionFromOps, type EditorState, type Transaction } from "./transaction";
import type { Operation } from "./operations";
import type { Selection } from "./types";

export interface YjsBinding {
  /** Apply a local transaction; reflects ops into Y.Text inside a Y transaction. */
  applyLocal(tr: Transaction): void;
  /** Tear down the Y.Text observer. */
  dispose(): void;
}

interface AccessorCallbacks {
  (next: EditorState): void;
}

/**
 * Wire a Y.Text to a getter/setter pair so the binding can read and replace
 * the local EditorState as remote updates arrive.
 */
export function createYjsBinding(
  ytext: Y.Text,
  getState: () => EditorState,
  setState: AccessorCallbacks,
): YjsBinding {
  let suppressObserver = false;
  const ORIGIN = Symbol("kryton-editor");

  function observer(event: Y.YTextEvent, transaction: Y.Transaction) {
    if (suppressObserver) return;
    if (transaction.origin === ORIGIN) return;
    const ops: Operation[] = [];
    let cursor = 0;
    for (const delta of event.delta) {
      if (typeof delta.retain === "number") {
        cursor += delta.retain;
      } else if (typeof delta.insert === "string") {
        ops.push({ kind: "insert", at: cursor, text: delta.insert });
        cursor += delta.insert.length;
      } else if (typeof delta.delete === "number") {
        ops.push({ kind: "delete", from: cursor, to: cursor + delta.delete });
      }
    }
    if (ops.length === 0) return;
    const before = getState();
    const shiftedSelection = shiftSelection(before.selection, ops);
    const next = applyTransaction(before, transactionFromOps(ops, shiftedSelection));
    setState(next);
  }

  ytext.observe(observer);

  return {
    applyLocal(tr) {
      const next = applyTransaction(getState(), tr);
      setState(next);
      suppressObserver = true;
      try {
        ytext.doc!.transact(() => {
          for (const op of tr.ops) {
            switch (op.kind) {
              case "insert":
                ytext.insert(op.at, op.text);
                break;
              case "delete":
                ytext.delete(op.from, op.to - op.from);
                break;
              case "replace":
                ytext.delete(op.from, op.to - op.from);
                ytext.insert(op.from, op.text);
                break;
            }
          }
        }, ORIGIN);
      } finally {
        suppressObserver = false;
      }
    },
    dispose() {
      ytext.unobserve(observer);
    },
  };
}

/** Shift a Selection across a sequence of remote ops. */
function shiftSelection(sel: Selection, ops: readonly Operation[]): Selection {
  let { anchor, head } = sel;
  for (const op of ops) {
    if (op.kind === "insert") {
      if (op.at <= anchor) anchor += op.text.length;
      if (op.at <= head) head += op.text.length;
    } else if (op.kind === "delete") {
      const len = op.to - op.from;
      if (op.to <= anchor) anchor -= len;
      else if (op.from < anchor) anchor = op.from;
      if (op.to <= head) head -= len;
      else if (op.from < head) head = op.from;
    } else if (op.kind === "replace") {
      const oldLen = op.to - op.from;
      const newLen = op.text.length;
      const delta = newLen - oldLen;
      if (op.to <= anchor) anchor += delta;
      else if (op.from < anchor) anchor = op.from + newLen;
      if (op.to <= head) head += delta;
      else if (op.from < head) head = op.from + newLen;
    }
  }
  return { anchor, head };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/yjsBinding`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/yjsBinding.ts packages/ui/src/editor/state/__tests__/yjsBinding.test.ts
git commit -m "feat(editor/state): bidirectional Y.Text binding with selection shifting"
```

---

## Task EY-2: Awareness — TDD

**Files:**
- Create: `packages/ui/src/editor/state/awareness.ts`
- Create: `packages/ui/src/editor/state/__tests__/awareness.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createCursorAwareness } from "../awareness";

describe("cursor awareness", () => {
  it("publishes local cursor selection to awareness", () => {
    const ydoc = new Y.Doc();
    const aware = new Awareness(ydoc);
    const ca = createCursorAwareness(aware, "user-1", "Pascal", "#aabbcc");
    ca.publish({ anchor: 5, head: 7 });
    const states = aware.getStates();
    const local = states.get(aware.clientID)!;
    expect(local.cursor).toEqual({ anchor: 5, head: 7 });
    expect(local.user).toEqual({ id: "user-1", name: "Pascal", color: "#aabbcc" });
    ca.dispose();
  });

  it("collects remote cursors from awareness state", () => {
    const ydoc = new Y.Doc();
    const aware = new Awareness(ydoc);
    aware.setLocalState({ user: { id: "u1", name: "A", color: "#111" }, cursor: { anchor: 1, head: 1 } });
    // Simulate a remote client by setting a state under a different clientID
    aware.states.set(999, { user: { id: "u2", name: "B", color: "#222" }, cursor: { anchor: 3, head: 5 } });
    const ca = createCursorAwareness(aware, "u1", "A", "#111");
    const remotes = ca.remotes();
    expect(remotes).toContainEqual({
      clientId: 999, user: { id: "u2", name: "B", color: "#222" }, cursor: { anchor: 3, head: 5 },
    });
    ca.dispose();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- editor/state/__tests__/awareness`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/editor/state/awareness.ts
import type { Awareness } from "y-protocols/awareness";
import type { Selection } from "./types";

export interface RemoteCursor {
  clientId: number;
  user: { id: string; name: string; color: string };
  cursor: Selection;
}

export interface CursorAwareness {
  publish(selection: Selection): void;
  remotes(): RemoteCursor[];
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export function createCursorAwareness(
  awareness: Awareness, userId: string, userName: string, userColor: string,
): CursorAwareness {
  const localUser = { id: userId, name: userName, color: userColor };
  awareness.setLocalStateField("user", localUser);

  const subs = new Set<() => void>();
  const onUpdate = () => subs.forEach((cb) => cb());
  awareness.on("update", onUpdate);

  return {
    publish(selection) {
      awareness.setLocalStateField("cursor", selection);
    },
    remotes() {
      const out: RemoteCursor[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        if (!state || !state.user || !state.cursor) continue;
        out.push({ clientId, user: state.user, cursor: state.cursor });
      }
      return out;
    },
    onChange(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    dispose() {
      awareness.off("update", onUpdate);
      subs.clear();
    },
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- editor/state/__tests__/awareness`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/editor/state/awareness.ts packages/ui/src/editor/state/__tests__/awareness.test.ts
git commit -m "feat(editor/state): cursor awareness via y-protocols"
```

---

## Task EY-3: Re-export from barrel

**Files:**
- Modify: `packages/ui/src/editor/state/index.ts`

- [ ] **Step 1: Append exports**

Add to the existing barrel:

```ts
export type { YjsBinding } from "./yjsBinding";
export { createYjsBinding } from "./yjsBinding";
export type { CursorAwareness, RemoteCursor } from "./awareness";
export { createCursorAwareness } from "./awareness";
```

- [ ] **Step 2: Confirm full state suite still passes**

Run: `cd packages/ui && npm test -- editor/state`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/state/index.ts
git commit -m "feat(editor/state): export Yjs binding and awareness from barrel"
```

---

## Task EY-4: Acceptance — collab smoke test on two-doc round trip

**Files:** none modified — verification only.

- [ ] **Step 1: Run all editor/state tests under Node env**

Run: `cd packages/ui && npm test -- editor/state`
Expected: all PASS, including the `@vitest-environment node` tests for yjsBinding and awareness.

- [ ] **Step 2: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor/state): yjs binding + awareness ready; replaces y-codemirror.next at the state layer"
```
