// packages/core/src/__tests__/events.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../events";

type Events = {
  change: { entityType: string; ids: string[] };
  "sync:start": void;
  [key: string]: unknown;
};

describe("EventBus", () => {
  it("calls handlers in order", () => {
    const bus = new EventBus<Events>();
    const a = vi.fn(); const b = vi.fn();
    bus.on("change", a); bus.on("change", b);
    bus.emit("change", { entityType: "notes", ids: ["1"] });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns unsubscribe", () => {
    const bus = new EventBus<Events>();
    const a = vi.fn();
    const off = bus.on("change", a);
    off();
    bus.emit("change", { entityType: "notes", ids: ["1"] });
    expect(a).not.toHaveBeenCalled();
  });

  it("isolates errors in handlers", () => {
    const bus = new EventBus<Events>();
    const a = vi.fn(() => { throw new Error("a"); });
    const b = vi.fn();
    bus.on("change", a); bus.on("change", b);
    bus.emit("change", { entityType: "notes", ids: ["1"] });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled(); // b runs even though a threw
  });

  it("supports void payloads", () => {
    const bus = new EventBus<Events>();
    const a = vi.fn();
    bus.on("sync:start", a);
    bus.emit("sync:start", undefined);
    expect(a).toHaveBeenCalled();
  });
});
