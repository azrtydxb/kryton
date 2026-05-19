import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchToActiveEditor,
  emitEditorTransaction,
  getActiveEditorState,
  getEditorPlugins,
  registerEditorPlugin,
  resetEditorRegistry,
  setActiveEditor,
  subscribeEditorPlugins,
  subscribeEditorTransactions,
} from "../editor-registry";
import type { EditorPlugin, EditorState, Transaction } from "../../editor/state";

const fakeState: EditorState = {
  doc: "hello",
  tree: { type: "root", children: [] } as unknown as EditorState["tree"],
  selection: { anchor: 0, head: 0 },
};

const fakeTr: Transaction = { ops: [], selection: null };

function plugin(name: string, extra: Partial<EditorPlugin> = {}): EditorPlugin {
  return { name, ...extra };
}

describe("editor-registry", () => {
  beforeEach(() => {
    resetEditorRegistry();
  });

  describe("registerEditorPlugin", () => {
    it("adds a plugin and the disposer removes it", () => {
      const p = plugin("a");
      const dispose = registerEditorPlugin(p);
      expect(getEditorPlugins()).toEqual([p]);
      dispose();
      expect(getEditorPlugins()).toEqual([]);
    });

    it("notifies subscribers on register + dispose", () => {
      const events: number[] = [];
      const unsub = subscribeEditorPlugins((plugins) => {
        events.push(plugins.length);
      });
      // immediate replay on subscribe
      expect(events).toEqual([0]);

      const dispose = registerEditorPlugin(plugin("a"));
      expect(events).toEqual([0, 1]);

      dispose();
      expect(events).toEqual([0, 1, 0]);

      unsub();
    });

    it("disposing an already-removed plugin does not double-notify", () => {
      const events: number[] = [];
      subscribeEditorPlugins((plugins) => {
        events.push(plugins.length);
      });
      const dispose = registerEditorPlugin(plugin("a"));
      const baseline = events.length;
      dispose();
      dispose();
      expect(events.length - baseline).toBe(1);
    });
  });

  describe("active editor handle", () => {
    it("getActiveEditorState returns null when no editor is mounted", () => {
      expect(getActiveEditorState()).toBeNull();
    });

    it("setActiveEditor + dispatch routes through the handle", () => {
      const dispatched: Transaction[] = [];
      setActiveEditor({
        getState: () => fakeState,
        dispatch: (tr) => dispatched.push(tr),
      });
      expect(getActiveEditorState()).toBe(fakeState);

      dispatchToActiveEditor(fakeTr);
      expect(dispatched).toEqual([fakeTr]);

      setActiveEditor(null);
      expect(getActiveEditorState()).toBeNull();
      // dispatch on no-active is a silent no-op (no throw).
      dispatchToActiveEditor(fakeTr);
    });
  });

  describe("transaction listeners", () => {
    it("subscribers receive every emitted transaction", () => {
      const seen: Array<[Transaction, EditorState]> = [];
      const dispose = subscribeEditorTransactions((tr, st) => {
        seen.push([tr, st]);
      });
      emitEditorTransaction(fakeTr, fakeState);
      emitEditorTransaction(fakeTr, fakeState);
      expect(seen.length).toBe(2);

      dispose();
      emitEditorTransaction(fakeTr, fakeState);
      expect(seen.length).toBe(2);
    });

    it("a throwing listener does not block subsequent listeners", () => {
      const seen: string[] = [];
      subscribeEditorTransactions(() => {
        throw new Error("first");
      });
      subscribeEditorTransactions(() => {
        seen.push("second");
      });
      emitEditorTransaction(fakeTr, fakeState);
      expect(seen).toEqual(["second"]);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// onKeyDown cascade contract
//
// The cascade lives inside EditorView.web.tsx, but the contract — first
// non-null result wins, "prevent-default" swallows without dispatch — can
// be unit-tested against a pure helper that mirrors the same loop. This
// test reproduces the loop so a regression in the algorithm shows up here
// in addition to whatever DOM-level test wires the real view.
// ──────────────────────────────────────────────────────────────────────────────

function runKeyDownCascade(
  plugins: readonly EditorPlugin[],
  e: KeyboardEvent,
  state: EditorState,
): { dispatched: Transaction | null; consumed: boolean } {
  for (const p of plugins) {
    if (!p.onKeyDown) continue;
    const result = p.onKeyDown(e, state);
    if (result === null || result === undefined) continue;
    if (result === "prevent-default") return { dispatched: null, consumed: true };
    return { dispatched: result, consumed: true };
  }
  return { dispatched: null, consumed: false };
}

describe("onKeyDown cascade", () => {
  const ev = new KeyboardEvent("keydown", { key: "a" });

  it("returns the first plugin's transaction when it claims the key", () => {
    const order: string[] = [];
    const tr = { ops: [], selection: null } as Transaction;
    const plugins: EditorPlugin[] = [
      {
        name: "first",
        onKeyDown: () => {
          order.push("first");
          return tr;
        },
      },
      {
        name: "second",
        onKeyDown: () => {
          order.push("second");
          return tr;
        },
      },
    ];
    const r = runKeyDownCascade(plugins, ev, fakeState);
    expect(r.consumed).toBe(true);
    expect(r.dispatched).toBe(tr);
    expect(order).toEqual(["first"]);
  });

  it("passes through when a plugin returns null", () => {
    const order: string[] = [];
    const tr = { ops: [], selection: null } as Transaction;
    const plugins: EditorPlugin[] = [
      {
        name: "pass",
        onKeyDown: () => {
          order.push("pass");
          return null;
        },
      },
      {
        name: "claim",
        onKeyDown: () => {
          order.push("claim");
          return tr;
        },
      },
    ];
    const r = runKeyDownCascade(plugins, ev, fakeState);
    expect(r.dispatched).toBe(tr);
    expect(order).toEqual(["pass", "claim"]);
  });

  it("\"prevent-default\" consumes the event with no dispatch", () => {
    const plugins: EditorPlugin[] = [
      { name: "swallow", onKeyDown: () => "prevent-default" as const },
      {
        name: "would-claim",
        onKeyDown: () => ({ ops: [], selection: null }) as Transaction,
      },
    ];
    const r = runKeyDownCascade(plugins, ev, fakeState);
    expect(r.consumed).toBe(true);
    expect(r.dispatched).toBeNull();
  });

  it("returns not-consumed when no plugin claims the key", () => {
    const plugins: EditorPlugin[] = [
      { name: "a", onKeyDown: () => null },
      { name: "b" }, // no handler
    ];
    const r = runKeyDownCascade(plugins, ev, fakeState);
    expect(r.consumed).toBe(false);
    expect(r.dispatched).toBeNull();
  });
});
