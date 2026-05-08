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
