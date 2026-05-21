import { describe, it, expect, vi } from "vitest";
import { NotificationBus, type NotificationEvent } from "../services/notifications/bus.js";

function makeEvent(userId: string): NotificationEvent {
  return {
    id: "evt-1",
    userId,
    kind: "custom",
    title: "Test",
    body: "Test body",
    createdAt: new Date().toISOString(),
  };
}

describe("NotificationBus", () => {
  it("delivers an event to a subscribed user", async () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    bus.subscribe("user-a", handler);

    const event = makeEvent("user-a");
    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not deliver an event to a different user", async () => {
    const bus = new NotificationBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.subscribe("user-a", handlerA);
    bus.subscribe("user-b", handlerB);

    await bus.publish(makeEvent("user-a"));

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it("stops delivering events after unsubscribe", async () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    const unsub = bus.subscribe("user-a", handler);

    await bus.publish(makeEvent("user-a"));
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    await bus.publish(makeEvent("user-a"));
    expect(handler).toHaveBeenCalledOnce(); // still once, not twice
  });
});
