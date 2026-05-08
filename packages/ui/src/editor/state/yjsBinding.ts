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

type SetState = (next: EditorState) => void;

/**
 * Wire a Y.Text to a getter/setter pair so the binding can read and replace
 * the local EditorState as remote updates arrive.
 */
export function createYjsBinding(
  ytext: Y.Text,
  getState: () => EditorState,
  setState: SetState,
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
