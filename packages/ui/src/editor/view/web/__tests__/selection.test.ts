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
    r.setStart(root.children[1]!.firstChild!, 3); // "wor|ld"
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
