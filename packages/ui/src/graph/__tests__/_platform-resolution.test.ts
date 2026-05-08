import { describe, it, expect } from "vitest";
import { PLATFORM_TAG } from "../_platform-probe";

describe("platform extension resolution", () => {
  it("resolves the .web.ts variant under vitest (jsdom)", () => {
    expect(PLATFORM_TAG).toBe("web");
  });
});
