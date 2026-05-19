/** @vitest-environment jsdom */
import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { EditorView } from "../view/web/EditorView.web";
import {
  resetEditorOptions,
  setEditorOption,
} from "../../plugins/editor-options";

describe("EditorView line-number gutter toggle", () => {
  beforeEach(() => {
    resetEditorOptions();
  });

  it("does NOT render the gutter by default", () => {
    const { container } = render(<EditorView initialDoc={"a\nb\nc"} />);
    expect(container.querySelector('[data-testid="ed-gutter"]')).toBeNull();
  });

  it("renders the gutter once lineNumbers is enabled, with one .ed-ln per doc line", async () => {
    const { container } = render(<EditorView initialDoc={"a\nb\nc"} />);
    expect(container.querySelector('[data-testid="ed-gutter"]')).toBeNull();

    await act(async () => {
      setEditorOption("lineNumbers", true);
    });

    const gutter = container.querySelector('[data-testid="ed-gutter"]');
    expect(gutter).toBeTruthy();
    expect(gutter?.querySelectorAll(".ed-ln").length).toBe(3);
  });

  it("hides the gutter again when lineNumbers is set back to false", async () => {
    const { container } = render(<EditorView initialDoc={"a\nb"} />);
    await act(async () => {
      setEditorOption("lineNumbers", true);
    });
    expect(container.querySelector('[data-testid="ed-gutter"]')).toBeTruthy();

    await act(async () => {
      setEditorOption("lineNumbers", false);
    });
    expect(container.querySelector('[data-testid="ed-gutter"]')).toBeNull();
  });
});
