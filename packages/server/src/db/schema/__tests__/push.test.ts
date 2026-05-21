import { describe, it, expect } from "vitest";
import { pushDevices } from "../push.js";

describe("push_devices schema", () => {
  it("declares the expected columns", () => {
    const cols = Object.keys(pushDevices);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "userId", "platform", "token", "lastSeenAt", "createdAt"]),
    );
  });
});
