import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, buildKeyPrefix } from "../apiKeyService.js";

describe("apiKeyService", () => {
  describe("generateApiKey", () => {
    it("returns a key starting with mnemo_ prefix", () => {
      const key = generateApiKey();
      expect(key).toMatch(/^mnemo_[a-f0-9]{64}$/);
    });

    it("generates unique keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("hashApiKey", () => {
    it("returns a hex SHA-256 hash", () => {
      const hash = hashApiKey("mnemo_abcdef1234567890");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces consistent hashes for the same input", () => {
      const key = "mnemo_test1234";
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it("produces different hashes for different inputs", () => {
      expect(hashApiKey("mnemo_aaa")).not.toBe(hashApiKey("mnemo_bbb"));
    });
  });

  describe("buildKeyPrefix", () => {
    it("returns mnemo_ plus first 8 hex chars of the key body", () => {
      const key = "mnemo_a1b2c3d4e5f6a7b8remaining";
      expect(buildKeyPrefix(key)).toBe("mnemo_a1b2c3d4");
    });
  });
});
