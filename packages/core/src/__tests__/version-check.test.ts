// packages/core/src/__tests__/version-check.test.ts
import { describe, it, expect } from "vitest";
import { isCompatibleVersion } from "../version-check";

describe("isCompatibleVersion", () => {
  it("matches in range", () => {
    expect(isCompatibleVersion("4.4.0", ">=4.4.0 <5.0.0")).toBe(true);
  });
  it("rejects below range", () => {
    expect(isCompatibleVersion("4.3.0", ">=4.4.0")).toBe(false);
  });
  it("rejects above range", () => {
    expect(isCompatibleVersion("5.0.0", "<5.0.0")).toBe(false);
  });
  it("accepts exact match at lower boundary", () => {
    expect(isCompatibleVersion("4.4.0", ">=4.4.0")).toBe(true);
  });
  it("accepts version within two-sided range", () => {
    expect(isCompatibleVersion("4.5.1", ">=4.4.0 <5.0.0")).toBe(true);
  });
  it("rejects pre-release from below if parsed correctly", () => {
    expect(isCompatibleVersion("4.3.9", ">=4.4.0 <5.0.0")).toBe(false);
  });
});
