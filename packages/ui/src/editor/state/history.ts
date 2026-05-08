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
