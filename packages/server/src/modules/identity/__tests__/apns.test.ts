import { describe, it, expect, vi } from "vitest";
import { sendApns, type ApnsResult } from "../services/push/apns.js";

describe("sendApns", () => {
  it("sends a notification and returns success on 200", async () => {
    const fakeProvider = {
      send: vi.fn().mockResolvedValue({ sent: [{ device: "tok" }], failed: [] }),
    };
    const res: ApnsResult = await sendApns(
      { token: "tok", title: "Hi", body: "Hello", deepLink: "kryton://x" },
      { provider: fakeProvider as any, bundleId: "com.kryton.mobile" },
    );
    expect(res).toEqual({ ok: true });
    expect(fakeProvider.send).toHaveBeenCalledOnce();
  });

  it("returns permanent failure on BadDeviceToken", async () => {
    const fakeProvider = {
      send: vi.fn().mockResolvedValue({
        sent: [],
        failed: [{ device: "tok", response: { reason: "BadDeviceToken" }, status: "410" }],
      }),
    };
    const res = await sendApns(
      { token: "tok", title: "Hi", body: "Hello" },
      { provider: fakeProvider as any, bundleId: "com.kryton.mobile" },
    );
    expect(res).toEqual({ ok: false, permanent: true, reason: "BadDeviceToken" });
  });

  it("returns transient failure on 5xx", async () => {
    const fakeProvider = {
      send: vi.fn().mockResolvedValue({
        sent: [],
        failed: [{ device: "tok", response: { reason: "InternalServerError" }, status: "500" }],
      }),
    };
    const res = await sendApns(
      { token: "tok", title: "Hi", body: "Hello" },
      { provider: fakeProvider as any, bundleId: "com.kryton.mobile" },
    );
    expect(res).toEqual({ ok: false, permanent: false, reason: "InternalServerError" });
  });
});
