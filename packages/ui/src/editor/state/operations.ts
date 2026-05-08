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
