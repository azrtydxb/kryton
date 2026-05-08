import { describe, it, expect } from "vitest";
import { createHitTest } from "../hitTest";

describe("createHitTest", () => {
  it("returns the closest node within the radius", () => {
    const ht = createHitTest([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 200, y: 200 },
    ], 10);
    expect(ht.test(2, 2)).toBe("a");
    expect(ht.test(98, 1)).toBe("b");
    expect(ht.test(50, 50)).toBeNull();
  });

  it("rebuild resets the index", () => {
    const ht = createHitTest([{ id: "a", x: 0, y: 0 }], 10);
    ht.rebuild([{ id: "a", x: 500, y: 500 }]);
    expect(ht.test(0, 0)).toBeNull();
    expect(ht.test(498, 502)).toBe("a");
  });
});
