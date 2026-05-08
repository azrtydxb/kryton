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
