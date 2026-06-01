import { describe, it, expect, vi } from "vitest";
import { sendFcm, type FcmResult, type FcmDeps } from "../services/push/fcm.js";

describe("sendFcm", () => {
  it("returns ok on success", async () => {
    const messaging = { send: vi.fn().mockResolvedValue("projects/x/messages/123") };
    const res: FcmResult = await sendFcm(
      { token: "fcm-tok", title: "Hi", body: "Hello", deepLink: "kryton://x" },
      { messaging: messaging as unknown as FcmDeps["messaging"] },
    );
    expect(res).toEqual({ ok: true });
  });

  it("returns permanent failure on UNREGISTERED", async () => {
    const messaging = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("Requested entity was not found."), {
          code: "messaging/registration-token-not-registered",
        }),
      ),
    };
    const res = await sendFcm(
      { token: "fcm-tok", title: "Hi", body: "Hello" },
      { messaging: messaging as unknown as FcmDeps["messaging"] },
    );
    expect(res).toEqual({
      ok: false,
      permanent: true,
      reason: "messaging/registration-token-not-registered",
    });
  });

  it("returns transient failure on internal errors", async () => {
    const messaging = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("internal"), { code: "messaging/internal-error" }),
      ),
    };
    const res = await sendFcm(
      { token: "fcm-tok", title: "Hi", body: "Hello" },
      { messaging: messaging as unknown as FcmDeps["messaging"] },
    );
    expect(res).toEqual({ ok: false, permanent: false, reason: "messaging/internal-error" });
  });
});
