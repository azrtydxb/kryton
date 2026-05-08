// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createEditorState } from "../transaction";
import { createYjsBinding } from "../yjsBinding";

describe("yjs binding", () => {
  it("local insert is reflected into Y.Text", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("body");
    let state = createEditorState("");
    const binding = createYjsBinding(ytext, () => state, (s) => { state = s; });

    binding.applyLocal({ ops: [{ kind: "insert", at: 0, text: "hello" }], selection: { anchor: 5, head: 5 } });
    expect(ytext.toString()).toBe("hello");
    expect(state.doc).toBe("hello");
    binding.dispose();
  });

  it("remote Y.Text op is reflected into a Transaction on local state", () => {
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText("body");
    let state1 = createEditorState("");
    const binding1 = createYjsBinding(ytext1, () => state1, (s) => { state1 = s; });

    const ydoc2 = new Y.Doc();
    const ytext2 = ydoc2.getText("body");
    let state2 = createEditorState("");
    const binding2 = createYjsBinding(ytext2, () => state2, (s) => { state2 = s; });

    // Wire two docs together via update messages.
    ydoc1.on("update", (u: Uint8Array) => Y.applyUpdate(ydoc2, u));
    ydoc2.on("update", (u: Uint8Array) => Y.applyUpdate(ydoc1, u));

    binding1.applyLocal({ ops: [{ kind: "insert", at: 0, text: "from-1" }], selection: { anchor: 6, head: 6 } });
    expect(state2.doc).toBe("from-1");

    binding2.applyLocal({ ops: [{ kind: "insert", at: 6, text: "/2" }], selection: { anchor: 8, head: 8 } });
    expect(state1.doc).toBe("from-1/2");

    binding1.dispose();
    binding2.dispose();
  });

  it("offsets shift correctly when a remote insert lands before the local caret", () => {
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText("body");
    let state1 = createEditorState("hello", { anchor: 5, head: 5 });
    const binding1 = createYjsBinding(ytext1, () => state1, (s) => { state1 = s; });
    ytext1.insert(0, "[1]"); // simulate a remote applyUpdate path

    expect(state1.doc).toBe("[1]hello");
    expect(state1.selection).toEqual({ anchor: 8, head: 8 });
    binding1.dispose();
  });

  it("dispose unsubscribes Y.Text observer", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("body");
    let state = createEditorState("");
    const binding = createYjsBinding(ytext, () => state, (s) => { state = s; });
    binding.dispose();
    ytext.insert(0, "ignored");
    expect(state.doc).toBe(""); // observer was removed before insert
  });
});
