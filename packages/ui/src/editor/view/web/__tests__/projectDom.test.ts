import { describe, it, expect } from "vitest";
import { projectDom } from "../projectDom";
import type { DecorationSpec } from "../../../state/types";

describe("projectDom", () => {
  it("emits a single text run when there are no decorations", () => {
    const runs = projectDom("hello world", []);
    expect(runs).toEqual([{ kind: null, text: "hello world", from: 0, to: 11 }]);
  });

  it("splits text around a single decoration", () => {
    const decos: DecorationSpec[] = [{ from: 6, to: 11, kind: "bold" }];
    const runs = projectDom("hello world", decos);
    expect(runs).toEqual([
      { kind: null, text: "hello ", from: 0, to: 6 },
      { kind: "bold", text: "world", from: 6, to: 11, attrs: undefined },
      { kind: null, text: "", from: 11, to: 11 },
    ].filter((r) => r.text !== ""));
  });

  it("handles overlapping decorations by emitting nested runs (outer first)", () => {
    const decos: DecorationSpec[] = [
      { from: 0, to: 11, kind: "blockquote" },
      { from: 6, to: 11, kind: "bold" },
    ];
    const runs = projectDom("hello world", decos);
    // The mapper flattens — outer decoration on the surrounding range, the
    // overlap section gets the inner kind. Only one kind per run in v1.
    expect(runs.map((r) => r.kind)).toEqual(["blockquote", "bold"]);
  });

  it("preserves wikilink target attr", () => {
    const decos: DecorationSpec[] = [{ from: 4, to: 16, kind: "wikilink", attrs: { target: "Other" } }];
    const runs = projectDom("see [[Other]]!", decos);
    const wl = runs.find((r) => r.kind === "wikilink");
    expect(wl?.attrs?.target).toBe("Other");
  });
});
