import { describe, it, expect } from "vitest";
import { drawScene } from "../drawScene";
import { createFakePainter } from "./fakePainter";
import type { Scene } from "../Painter";

const baseScene = (): Scene => ({
  nodes: [
    {
      node: { id: "a", title: "A", path: "a.md" },
      position: { id: "a", x: 100, y: 100 },
      isActive: true, isHovered: false, isStarred: false, isShared: false,
      isVisible: true, isInLocalSet: true,
    },
    {
      node: { id: "b", title: "B", path: "b.md" },
      position: { id: "b", x: 200, y: 200 },
      isActive: false, isHovered: false, isStarred: true, isShared: false,
      isVisible: true, isInLocalSet: true,
    },
  ],
  edges: [
    {
      fromPosition: { id: "a", x: 100, y: 100 },
      toPosition: { id: "b", x: 200, y: 200 },
      isActive: false, isHovered: false, isInLocalSet: true,
    },
  ],
  transform: { x: 0, y: 0, k: 1 },
  theme: "dark",
  mode: "global",
});

describe("drawScene", () => {
  it("opens a frame, draws edges before nodes, closes frame", () => {
    const { painter, calls } = createFakePainter();
    drawScene(painter, baseScene(), 400, 400);
    expect(calls.at(0)?.kind).toBe("beginFrame");
    expect(calls.at(-1)?.kind).toBe("endFrame");
    const lineIdx = calls.findIndex((c) => c.kind === "line");
    const circleIdx = calls.findIndex((c) => c.kind === "circle");
    expect(lineIdx).toBeGreaterThan(-1);
    expect(circleIdx).toBeGreaterThan(lineIdx);
  });

  it("draws a star for starred non-active nodes", () => {
    const { painter, calls } = createFakePainter();
    drawScene(painter, baseScene(), 400, 400);
    expect(calls.some((c) => c.kind === "star")).toBe(true);
  });

  it("applies the viewport transform via translate+scale", () => {
    const { painter, calls } = createFakePainter();
    const scene = baseScene();
    scene.transform = { x: 50, y: 60, k: 2 };
    drawScene(painter, scene, 400, 400);
    const tr = calls.find((c) => c.kind === "translate") as { x: number; y: number; kind: "translate" };
    const sc = calls.find((c) => c.kind === "scale") as { s: number; kind: "scale" };
    expect(tr.x).toBe(50);
    expect(tr.y).toBe(60);
    expect(sc.s).toBe(2);
  });

  it("ghosts non-local-set elements in local mode", () => {
    const { painter, calls } = createFakePainter();
    const scene = baseScene();
    scene.mode = "local";
    const node1 = scene.nodes[1];
    if (node1) node1.isInLocalSet = false;
    drawScene(painter, scene, 400, 400);
    const ghostedCircle = calls.find(
      (c) => c.kind === "circle" && (c.style.alpha ?? 1) < 0.5,
    );
    expect(ghostedCircle).toBeTruthy();
  });
});
