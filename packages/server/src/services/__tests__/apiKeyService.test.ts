import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, buildKeyPrefix } from "../apiKeyService.js";

describe("apiKeyService", () => {
  describe("generateApiKey", () => {
    it("returns a key starting with kryton_ prefix", () => {
      const key = generateApiKey();
      expect(key).toMatch(/^kryton_[a-f0-9]{64}$/);
    });

    it("generates unique keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("hashApiKey", () => {
    it("returns a hex SHA-256 hash", () => {
      const hash = hashApiKey("kryton_abcdef1234567890");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces consistent hashes for the same input", () => {
      const key = "kryton_test1234";
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it("produces different hashes for different inputs", () => {
      expect(hashApiKey("kryton_aaa")).not.toBe(hashApiKey("kryton_bbb"));
    });
  });

  describe("buildKeyPrefix", () => {
    it("returns kryton_ plus first 8 hex chars of the key body", () => {
      const key = "kryton_a1b2c3d4e5f6a7b8remaining";
      expect(buildKeyPrefix(key)).toBe("kryton_a1b2c3d4");
    });
  });
});
