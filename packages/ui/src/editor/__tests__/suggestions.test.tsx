/** @vitest-environment jsdom */
import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import {
  detectTriggerOnInsert,
  refreshTrigger,
} from "../view/web/suggestionTrigger";
import { SuggestionPopup } from "../view/web/SuggestionPopup";
import { EditorView } from "../view/web/EditorView.web";
import type { EditorPlugin, Suggestion, SuggestionTrigger } from "../state";
import { resetEditorRegistry } from "../../plugins/editor-registry";

// ── detectTriggerOnInsert ───────────────────────────────────────────────────

describe("detectTriggerOnInsert", () => {
  it("fires slash trigger at start of line", () => {
    const t = detectTriggerOnInsert("", 0, "/");
    expect(t).toMatchObject({ kind: "slash", from: 1, caret: 1, query: "" });
  });

  it("fires slash trigger after whitespace", () => {
    const t = detectTriggerOnInsert("hello ", 6, "/");
    expect(t).toMatchObject({ kind: "slash", from: 7 });
  });

  it("does NOT fire slash trigger mid-word", () => {
    expect(detectTriggerOnInsert("hello", 5, "/")).toBeNull();
  });

  it("fires tag trigger after newline", () => {
    const t = detectTriggerOnInsert("a\n", 2, "#");
    expect(t).toMatchObject({ kind: "tag", from: 3 });
  });

  it("fires wikilink trigger on second [", () => {
    const t = detectTriggerOnInsert("foo [", 5, "[");
    expect(t).toMatchObject({ kind: "wikilink", from: 6 });
  });

  it("does NOT fire wikilink trigger on single [", () => {
    expect(detectTriggerOnInsert("foo ", 4, "[")).toBeNull();
  });

  it("ignores multi-char insertions", () => {
    expect(detectTriggerOnInsert("", 0, "/x")).toBeNull();
  });
});

// ── refreshTrigger ──────────────────────────────────────────────────────────

describe("refreshTrigger", () => {
  const base: SuggestionTrigger = {
    kind: "slash",
    from: 1,
    caret: 1,
    query: "",
  };

  it("updates query as caret advances", () => {
    const next = refreshTrigger(base, "/foo", 4);
    expect(next).toMatchObject({ query: "foo", caret: 4 });
  });

  it("closes when caret moves before `from`", () => {
    expect(refreshTrigger(base, "/foo", 0)).toBeNull();
  });

  it("closes slash trigger on whitespace in query", () => {
    expect(refreshTrigger(base, "/fo o", 5)).toBeNull();
  });

  it("closes on newline in query", () => {
    expect(refreshTrigger(base, "/fo\n", 4)).toBeNull();
  });

  it("closes wikilink trigger on ]", () => {
    const wl: SuggestionTrigger = {
      kind: "wikilink",
      from: 2,
      caret: 2,
      query: "",
    };
    expect(refreshTrigger(wl, "[[a]", 4)).toBeNull();
  });
});

// ── SuggestionPopup ─────────────────────────────────────────────────────────

describe("SuggestionPopup", () => {
  const items: Suggestion[] = [
    { id: "a", label: "Apple", kind: "command", insert: "apple" },
    { id: "b", label: "Banana", kind: "command", insert: "banana" },
  ];

  it("renders all items and marks the active one", () => {
    const { getAllByRole } = render(
      <SuggestionPopup
        items={items}
        activeIndex={1}
        top={0}
        left={0}
        onPick={() => {}}
        onHover={() => {}}
      />,
    );
    const opts = getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[1]?.getAttribute("aria-selected")).toBe("true");
    expect(opts[0]?.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onPick on mousedown", () => {
    let picked: Suggestion | null = null;
    const { getAllByRole } = render(
      <SuggestionPopup
        items={items}
        activeIndex={0}
        top={0}
        left={0}
        onPick={(it) => (picked = it)}
        onHover={() => {}}
      />,
    );
    fireEvent.mouseDown(getAllByRole("option")[0]!);
    expect(picked).not.toBeNull();
    expect((picked as unknown as Suggestion).id).toBe("a");
  });

  it("renders nothing when items are empty", () => {
    const { container } = render(
      <SuggestionPopup
        items={[]}
        activeIndex={0}
        top={0}
        left={0}
        onPick={() => {}}
        onHover={() => {}}
      />,
    );
    expect(container.querySelector('[data-suggestion-popup=""]')).toBeNull();
  });
});

// ── EditorView integration ─────────────────────────────────────────────────

function makeSuggestionPlugin(
  items: Suggestion[],
  capture?: (t: SuggestionTrigger) => void,
): EditorPlugin {
  return {
    name: "test-suggestions",
    suggestions: async (_state, trigger) => {
      capture?.(trigger);
      return items;
    },
  };
}

describe("EditorView suggestion integration", () => {
  beforeEach(() => {
    resetEditorRegistry();
  });

  it("opens the popup when '/' is typed at start of line", async () => {
    const plugin = makeSuggestionPlugin([
      { id: "h1", label: "Heading 1", kind: "command", insert: "# " },
    ]);

    const { container } = render(
      <EditorView initialDoc="" plugins={[plugin]} />,
    );

    const root = container.querySelector(
      '[data-editor-root=""]',
    ) as HTMLDivElement;
    expect(root).toBeTruthy();

    // Place caret at offset 0.
    const sel = window.getSelection()!;
    const r = document.createRange();
    const firstChild = root.firstChild ?? root;
    r.setStart(firstChild, 0);
    r.setEnd(firstChild, 0);
    sel.removeAllRanges();
    sel.addRange(r);

    // Simulate beforeinput "/" — interpretBeforeInput inserts it and
    // detectTriggerOnInsert flags the trigger.
    await act(async () => {
      const ev = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "/",
        bubbles: true,
        cancelable: true,
      });
      // jsdom doesn't implement getTargetRanges — stub it.
      Object.defineProperty(ev, "getTargetRanges", {
        value: () => [],
      });
      root.dispatchEvent(ev);
    });

    // Allow the async suggestions() promise to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const popup = document.querySelector('[data-suggestion-popup=""]');
    expect(popup).toBeTruthy();
    expect(popup?.textContent).toContain("Heading 1");
  });

  it("ArrowDown moves the active suggestion", async () => {
    const plugin = makeSuggestionPlugin([
      { id: "a", label: "Alpha", kind: "command", insert: "A" },
      { id: "b", label: "Beta", kind: "command", insert: "B" },
    ]);

    const { container } = render(
      <EditorView initialDoc="" plugins={[plugin]} />,
    );
    const root = container.querySelector(
      '[data-editor-root=""]',
    ) as HTMLDivElement;

    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(root.firstChild ?? root, 0);
    r.setEnd(root.firstChild ?? root, 0);
    sel.removeAllRanges();
    sel.addRange(r);

    await act(async () => {
      const ev = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "/",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ev, "getTargetRanges", { value: () => [] });
      root.dispatchEvent(ev);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Press ArrowDown
    fireEvent.keyDown(root, { key: "ArrowDown" });

    const opts = document.querySelectorAll(
      '[data-suggestion-popup=""] [role="option"]',
    );
    expect(opts[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("Escape closes the popup", async () => {
    const plugin = makeSuggestionPlugin([
      { id: "a", label: "Alpha", kind: "command", insert: "A" },
    ]);
    const { container } = render(
      <EditorView initialDoc="" plugins={[plugin]} />,
    );
    const root = container.querySelector(
      '[data-editor-root=""]',
    ) as HTMLDivElement;

    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(root.firstChild ?? root, 0);
    r.setEnd(root.firstChild ?? root, 0);
    sel.removeAllRanges();
    sel.addRange(r);

    await act(async () => {
      const ev = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "/",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ev, "getTargetRanges", { value: () => [] });
      root.dispatchEvent(ev);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-suggestion-popup=""]')).toBeTruthy();

    fireEvent.keyDown(root, { key: "Escape" });
    expect(document.querySelector('[data-suggestion-popup=""]')).toBeNull();
  });

  it("Enter applies the suggestion and replaces the trigger range", async () => {
    const plugin = makeSuggestionPlugin([
      { id: "x", label: "Insert X", kind: "command", insert: "XYZ" },
    ]);

    let lastState: { doc: string } | null = null;
    const { container } = render(
      <EditorView
        initialDoc=""
        plugins={[plugin]}
        onChange={(s) => {
          lastState = s;
        }}
      />,
    );
    const root = container.querySelector(
      '[data-editor-root=""]',
    ) as HTMLDivElement;

    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(root.firstChild ?? root, 0);
    r.setEnd(root.firstChild ?? root, 0);
    sel.removeAllRanges();
    sel.addRange(r);

    await act(async () => {
      const ev = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "/",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ev, "getTargetRanges", { value: () => [] });
      root.dispatchEvent(ev);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Doc now is "/"; trigger.from=1, caret=1; Enter should replace [1..1]
    // with "XYZ" → doc becomes "/XYZ".
    fireEvent.keyDown(root, { key: "Enter" });

    expect(lastState).not.toBeNull();
    expect((lastState as unknown as { doc: string }).doc).toBe("/XYZ");
    expect(document.querySelector('[data-suggestion-popup=""]')).toBeNull();
  });
});
