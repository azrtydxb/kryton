/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getEditorOptions,
  resetEditorOptions,
  setEditorOption,
  subscribeEditorOptions,
} from "../editor-options";

describe("editor-options store", () => {
  beforeEach(() => {
    resetEditorOptions();
  });

  it("starts with default lineNumbers=false", () => {
    expect(getEditorOptions()).toEqual({ lineNumbers: false });
  });

  it("setEditorOption updates and notifies subscribers", () => {
    const cb = vi.fn();
    subscribeEditorOptions(cb);
    cb.mockClear(); // drop the initial snapshot fire

    setEditorOption("lineNumbers", true);

    expect(getEditorOptions().lineNumbers).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumbers: true }),
    );
  });

  it("setEditorOption is a no-op when the value is unchanged", () => {
    const cb = vi.fn();
    subscribeEditorOptions(cb);
    cb.mockClear();
    setEditorOption("lineNumbers", false); // same as default
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscriber unsubscribe stops notifications", () => {
    const cb = vi.fn();
    const unsub = subscribeEditorOptions(cb);
    cb.mockClear();
    unsub();
    setEditorOption("lineNumbers", true);
    expect(cb).not.toHaveBeenCalled();
  });

  it("accepts unknown keys (forward compat)", () => {
    setEditorOption("wordWrap", true);
    expect(getEditorOptions().wordWrap).toBe(true);
  });
});
