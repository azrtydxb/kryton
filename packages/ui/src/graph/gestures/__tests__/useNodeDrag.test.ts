import { describe, it, expect, vi } from "vitest";
import { applyDragStart, applyDragMove, applyDragEnd } from "../useNodeDrag";
import type { LayoutHandle } from "../../layout/types";

function fakeLayout(): LayoutHandle {
  return {
    step: vi.fn(),
    getPosition: vi.fn(),
    positions: vi.fn(() => [].values()),
    pin: vi.fn(),
    unpin: vi.fn(),
    reheat: vi.fn(),
    setBounds: vi.fn(),
    dispose: vi.fn(),
  } as unknown as LayoutHandle;
}

describe("node drag flow", () => {
  it("pins on start", () => {
    const l = fakeLayout();
    applyDragStart(l, "n1", 10, 20);
    expect(l.pin).toHaveBeenCalledWith("n1", 10, 20);
  });

  it("repins on move", () => {
    const l = fakeLayout();
    applyDragMove(l, "n1", 30, 40);
    expect(l.pin).toHaveBeenCalledWith("n1", 30, 40);
  });

  it("unpins and reheats on end", () => {
    const l = fakeLayout();
    applyDragEnd(l, "n1");
    expect(l.unpin).toHaveBeenCalledWith("n1");
    expect(l.reheat).toHaveBeenCalledWith(0.1);
  });
});
