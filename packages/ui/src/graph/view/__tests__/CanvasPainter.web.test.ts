import { describe, it, expect, vi } from "vitest";
import { createCanvasPainter } from "../CanvasPainter.web";

describe("CanvasPainter (web)", () => {
  it("invokes the underlying 2D context for primitive ops", () => {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 42 })),
      set strokeStyle(_v: string) {},
      set fillStyle(_v: string) {},
      set lineWidth(_n: number) {},
      set globalAlpha(_n: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;

    const p = createCanvasPainter(ctx);
    p.beginFrame(400, 400);
    p.drawCircle(10, 10, 5, { fill: "red" });
    p.drawLine(0, 0, 10, 10, { stroke: "blue", strokeWidth: 1 });
    p.drawStar(0, 0, 10, 5, 5, { fill: "yellow" });
    p.drawText(0, 0, "hi", 12, "Inter", "black");
    p.endFrame();

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
