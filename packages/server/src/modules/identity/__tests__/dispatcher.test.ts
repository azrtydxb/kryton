import { describe, it, expect, vi } from "vitest";
import { dispatchPush, type DispatcherDeps } from "../services/push/dispatcher.js";
import type { NotificationEvent } from "../services/notifications/bus.js";

function makeEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    id: "evt-1",
    userId: "user-a",
    kind: "custom",
    title: "Test title",
    body: "Test body",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<DispatcherDeps>): DispatcherDeps {
  return {
    sendApns: vi.fn().mockResolvedValue({ ok: true }),
    sendFcm: vi.fn().mockResolvedValue({ ok: true }),
    listDevices: vi.fn().mockResolvedValue([]),
    prune: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("dispatchPush", () => {
  it("fans out to ios and android devices", async () => {
    const deps = makeDeps({
      listDevices: vi.fn().mockResolvedValue([
        { id: "dev-ios", platform: "ios" as const, token: "apns-token" },
        { id: "dev-android", platform: "android" as const, token: "fcm-token" },
      ]),
    });

    await dispatchPush(makeEvent(), deps);

    expect(deps.sendApns).toHaveBeenCalledOnce();
    expect(deps.sendApns).toHaveBeenCalledWith(
      expect.objectContaining({ token: "apns-token", title: "Test title" }),
    );
    expect(deps.sendFcm).toHaveBeenCalledOnce();
    expect(deps.sendFcm).toHaveBeenCalledWith(
      expect.objectContaining({ token: "fcm-token", title: "Test title" }),
    );
    expect(deps.prune).not.toHaveBeenCalled();
  });

  it("prunes a device on permanent failure", async () => {
    const deps = makeDeps({
      listDevices: vi.fn().mockResolvedValue([
        { id: "dev-ios", platform: "ios" as const, token: "bad-token" },
      ]),
      sendApns: vi.fn().mockResolvedValue({ ok: false, permanent: true, reason: "BadDeviceToken" }),
    });

    await dispatchPush(makeEvent(), deps);

    expect(deps.prune).toHaveBeenCalledOnce();
    expect(deps.prune).toHaveBeenCalledWith("dev-ios");
  });

  it("does not prune on transient failure", async () => {
    const deps = makeDeps({
      listDevices: vi.fn().mockResolvedValue([
        { id: "dev-android", platform: "android" as const, token: "fcm-token" },
      ]),
      sendFcm: vi
        .fn()
        .mockResolvedValue({ ok: false, permanent: false, reason: "messaging/server-unavailable" }),
    });

    await dispatchPush(makeEvent(), deps);

    expect(deps.prune).not.toHaveBeenCalled();
  });
});
