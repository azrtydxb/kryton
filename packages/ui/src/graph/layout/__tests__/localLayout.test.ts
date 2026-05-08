import { describe, it, expect } from "vitest";
import { createLocalLayout } from "../localLayout";
import type { LayoutInput } from "../types";

const input: LayoutInput = {
  nodes: [
    { id: "active", title: "Active", path: "a.md" },
    { id: "n1", title: "N1", path: "n1.md" }, // 1-hop
    { id: "n2", title: "N2", path: "n2.md" }, // 1-hop
    { id: "n3", title: "N3", path: "n3.md" }, // 2-hop (via n1)
    { id: "n4", title: "N4", path: "n4.md" }, // 2-hop (via n2)
  ],
  edges: [
    { fromNoteId: "active", toNoteId: "n1" },
    { fromNoteId: "active", toNoteId: "n2" },
    { fromNoteId: "n1", toNoteId: "n3" },
    { fromNoteId: "n2", toNoteId: "n4" },
  ],
  mode: "local",
  activeId: "active",
  width: 400,
  height: 400,
};

describe("createLocalLayout", () => {
  it("pins active at center", () => {
    const layout = createLocalLayout(input);
    layout.step();
    const pos = layout.getPosition("active");
    expect(pos?.x).toBeCloseTo(200, 0);
    expect(pos?.y).toBeCloseTo(200, 0);
    layout.dispose();
  });

  it("places 1-hop nodes on inner ring (~30% of min dimension)", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 30; i++) layout.step();
    const r1 = 0.3 * 400;
    for (const id of ["n1", "n2"]) {
      const p = layout.getPosition(id)!;
      const dist = Math.hypot(p.x - 200, p.y - 200);
      expect(Math.abs(dist - r1)).toBeLessThan(5);
    }
    layout.dispose();
  });

  it("places 2-hop nodes on outer ring (~55% of min dimension)", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 30; i++) layout.step();
    const r2 = 0.55 * 400;
    for (const id of ["n3", "n4"]) {
      const p = layout.getPosition(id)!;
      const dist = Math.hypot(p.x - 200, p.y - 200);
      expect(Math.abs(dist - r2)).toBeLessThan(5);
    }
    layout.dispose();
  });

  it("setBounds rescales ring radii", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 20; i++) layout.step();
    layout.setBounds(800, 800);
    for (let i = 0; i < 20; i++) layout.step();
    const r1 = 0.3 * 800;
    const p = layout.getPosition("n1")!;
    const dist = Math.hypot(p.x - 400, p.y - 400);
    expect(Math.abs(dist - r1)).toBeLessThan(10);
    layout.dispose();
  });
});
