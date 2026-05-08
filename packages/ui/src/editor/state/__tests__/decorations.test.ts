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
