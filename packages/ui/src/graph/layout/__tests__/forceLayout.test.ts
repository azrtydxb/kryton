import { describe, it, expect } from "vitest";
import { createForceLayout } from "../forceLayout";
import type { LayoutInput } from "../types";

const input: LayoutInput = {
  nodes: [
    { id: "a", title: "A", path: "a.md" },
    { id: "b", title: "B", path: "b.md" },
    { id: "c", title: "C", path: "c.md" },
  ],
  edges: [
    { fromNoteId: "a", toNoteId: "b" },
    { fromNoteId: "b", toNoteId: "c" },
  ],
  mode: "global",
  activeId: null,
  width: 400,
  height: 400,
};

describe("createForceLayout", () => {
  it("returns finite positions after one step", () => {
    const layout = createForceLayout(input);
    layout.step();
    for (const p of layout.positions()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    layout.dispose();
  });

  it("converges (max delta shrinks across iterations)", () => {
    const layout = createForceLayout(input);
    const snapshot = () =>
      [...layout.positions()].map((p) => ({ id: p.id, x: p.x, y: p.y }));
    for (let i = 0; i < 50; i++) layout.step();
    const before = snapshot();
    for (let i = 0; i < 50; i++) layout.step();
    const after = snapshot();
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) {
      const dx = before[i]!.x - after[i]!.x;
      const dy = before[i]!.y - after[i]!.y;
      maxDelta = Math.max(maxDelta, Math.hypot(dx, dy));
    }
    // After 100 total steps, displacement per 50-step window should be tiny.
    expect(maxDelta).toBeLessThan(20);
    layout.dispose();
  });

  it("pin holds a node fixed across steps", () => {
    const layout = createForceLayout(input);
    layout.pin("a", 10, 20);
    for (let i = 0; i < 20; i++) layout.step();
    const pos = layout.getPosition("a");
    expect(pos?.x).toBe(10);
    expect(pos?.y).toBe(20);
    layout.dispose();
  });

  it("unpin allows the node to move again", () => {
    const layout = createForceLayout(input);
    layout.pin("a", 0, 0);
    for (let i = 0; i < 5; i++) layout.step();
    layout.unpin("a");
    for (let i = 0; i < 50; i++) layout.step();
    const pos = layout.getPosition("a");
    // After unpin and 50 ticks, the node should have moved off (0,0).
    expect(Math.hypot(pos!.x, pos!.y)).toBeGreaterThan(0.1);
    layout.dispose();
  });

  it("reheat increases per-tick movement", () => {
    const layout = createForceLayout(input);
    for (let i = 0; i < 200; i++) layout.step();
    const settledPositions = [...layout.positions()];
    layout.reheat(0.5);
    layout.step();
    let total = 0;
    for (const p of layout.positions()) {
      const prev = settledPositions.find((s) => s.id === p.id)!;
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
    }
    expect(total).toBeGreaterThan(0);
    layout.dispose();
  });
});
