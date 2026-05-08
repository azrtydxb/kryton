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
