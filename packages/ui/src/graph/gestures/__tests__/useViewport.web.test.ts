import { describe, it, expect } from "vitest";
import { applyWheelZoom, applyPanDelta, clampScale } from "../useViewport.web";

describe("viewport math (web)", () => {
  it("clampScale respects min/max", () => {
    expect(clampScale(10)).toBe(5);
    expect(clampScale(0.05)).toBe(0.2);
    expect(clampScale(1)).toBe(1);
  });

  it("applyWheelZoom keeps the focal point stable", () => {
    const before = { x: 0, y: 0, k: 1 };
    const after = applyWheelZoom(before, /*deltaY=*/-100, /*focalX=*/200, /*focalY=*/100);
    // After zooming in at (200,100), the world point under (200,100) must
    // still project to (200,100) with the new transform.
    const worldX = (200 - before.x) / before.k;
    const screenX = worldX * after.k + after.x;
    expect(screenX).toBeCloseTo(200, 4);
  });

  it("applyPanDelta translates by exactly delta", () => {
    const v = applyPanDelta({ x: 5, y: 5, k: 2 }, 10, -3);
    expect(v).toEqual({ x: 15, y: 2, k: 2 });
  });
});
