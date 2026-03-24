import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginEventBus } from "../PluginEventBus";

describe("PluginEventBus", () => {
  let bus: PluginEventBus;

  beforeEach(() => {
    bus = new PluginEventBus();
  });

  it("calls registered handlers for an event", async () => {
    const handler = vi.fn();
    bus.on("note:afterSave", handler);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler).toHaveBeenCalledWith({ path: "test.md" });
  });

  it("supports multiple handlers for the same event", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("note:afterSave", handler1);
    bus.on("note:afterSave", handler2);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("removes a handler with off()", async () => {
    const handler = vi.fn();
    bus.on("note:afterSave", handler);
    bus.off("note:afterSave", handler);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no handlers", async () => {
    await expect(bus.emit("note:afterSave", {})).resolves.toBeUndefined();
  });

  it("before events can cancel by throwing", async () => {
    bus.on("note:beforeSave", () => {
      throw new Error("cancelled");
    });
    await expect(bus.emitBefore("note:beforeSave", {})).rejects.toThrow("cancelled");
  });

  it("before events run in registration order", async () => {
    const order: number[] = [];
    bus.on("note:beforeSave", () => { order.push(1); });
    bus.on("note:beforeSave", () => { order.push(2); });
    await bus.emitBefore("note:beforeSave", {});
    expect(order).toEqual([1, 2]);
  });

  it("before event context is mutable across handlers", async () => {
    const ctx = { content: "original" };
    bus.on("note:beforeSave", (c) => { (c as Record<string, string>).content = "modified"; });
    await bus.emitBefore("note:beforeSave", ctx);
    expect(ctx.content).toBe("modified");
  });

  it("removeAllForPlugin removes only that plugin's handlers", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("note:afterSave", handler1, "plugin-a");
    bus.on("note:afterSave", handler2, "plugin-b");
    bus.removeAllForPlugin("plugin-a");
    await bus.emit("note:afterSave", {});
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });
});
