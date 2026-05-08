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
