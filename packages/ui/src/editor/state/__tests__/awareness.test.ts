// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createCursorAwareness } from "../awareness";

describe("cursor awareness", () => {
  it("publishes local cursor selection to awareness", () => {
    const ydoc = new Y.Doc();
    const aware = new Awareness(ydoc);
    const ca = createCursorAwareness(aware, "user-1", "Pascal", "#aabbcc");
    ca.publish({ anchor: 5, head: 7 });
    const states = aware.getStates();
    const local = states.get(aware.clientID)!;
    expect(local.cursor).toEqual({ anchor: 5, head: 7 });
    expect(local.user).toEqual({ id: "user-1", name: "Pascal", color: "#aabbcc" });
    ca.dispose();
  });

  it("collects remote cursors from awareness state", () => {
    const ydoc = new Y.Doc();
    const aware = new Awareness(ydoc);
    aware.setLocalState({ user: { id: "u1", name: "A", color: "#111" }, cursor: { anchor: 1, head: 1 } });
    // Simulate a remote client by setting a state under a different clientID
    aware.states.set(999, { user: { id: "u2", name: "B", color: "#222" }, cursor: { anchor: 3, head: 5 } });
    const ca = createCursorAwareness(aware, "u1", "A", "#111");
    const remotes = ca.remotes();
    expect(remotes).toContainEqual({
      clientId: 999, user: { id: "u2", name: "B", color: "#222" }, cursor: { anchor: 3, head: 5 },
    });
    ca.dispose();
  });
});
