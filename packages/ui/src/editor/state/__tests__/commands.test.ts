import { describe, it, expect } from "vitest";
import { createEditorState, applyTransaction } from "../transaction";
import { toggleBold, toggleItalic, insertWikilink } from "../commands";

describe("commands", () => {
  it("toggleBold wraps a selection with **", () => {
    const s1 = createEditorState("hello world", { anchor: 6, head: 11 });
    const s2 = applyTransaction(s1, toggleBold(s1));
    expect(s2.doc).toBe("hello **world**");
  });

  it("toggleBold removes ** when the selection is already wrapped", () => {
    const s1 = createEditorState("hello **world**", { anchor: 8, head: 13 });
    const s2 = applyTransaction(s1, toggleBold(s1));
    expect(s2.doc).toBe("hello world");
  });

  it("toggleItalic wraps a selection with *", () => {
    const s1 = createEditorState("hi there", { anchor: 3, head: 8 });
    const s2 = applyTransaction(s1, toggleItalic(s1));
    expect(s2.doc).toBe("hi *there*");
  });

  it("insertWikilink inserts [[Title]] at the caret", () => {
    const s1 = createEditorState("see ", { anchor: 4, head: 4 });
    const s2 = applyTransaction(s1, insertWikilink(s1, "Other"));
    expect(s2.doc).toBe("see [[Other]]");
  });
});
