import { describe, it, expect } from "vitest";
import { createKrytonClient } from "../src/index.js";

describe("@azrtydxb/sdk React Native compatibility", () => {
  it("constructs a client without touching DOM globals", () => {
    // Simulate RN: DOM globals are undefined.
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    try {
      const client = createKrytonClient({ baseUrl: "http://localhost:3001" });
      expect(typeof client.GET).toBe("function");
      expect(typeof client.POST).toBe("function");
    } finally {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    }
  });

  it("exports the expected type aliases", () => {
    // Type-only assertions; ensures the public surface is stable.
    type _Probe = import("../src/index.js").UserPublicProfile;
    expect(true).toBe(true);
  });
});
