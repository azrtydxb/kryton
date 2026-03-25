import { describe, it, expect, vi, beforeEach } from "vitest";
import * as apiKeyService from "../../services/apiKeyService.js";

vi.mock("../../services/apiKeyService.js");

describe("apiKey routes (unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("createApiKey is callable with correct params", async () => {
    const mockCreate = vi.mocked(apiKeyService.createApiKey);
    mockCreate.mockResolvedValue({
      id: "key-1",
      key: "mnemo_abc123",
      keyPrefix: "mnemo_ab",
      name: "Test",
      scope: "read-only",
      expiresAt: null,
      createdAt: new Date(),
    });

    const result = await apiKeyService.createApiKey("user-1", "Test", "read-only", null);
    expect(result.key).toBe("mnemo_abc123");
    expect(mockCreate).toHaveBeenCalledWith("user-1", "Test", "read-only", null);
  });

  it("listApiKeys is callable with userId", async () => {
    const mockList = vi.mocked(apiKeyService.listApiKeys);
    mockList.mockResolvedValue([]);

    const result = await apiKeyService.listApiKeys("user-1");
    expect(result).toEqual([]);
    expect(mockList).toHaveBeenCalledWith("user-1");
  });

  it("revokeApiKey is callable with userId and keyId", async () => {
    const mockRevoke = vi.mocked(apiKeyService.revokeApiKey);
    mockRevoke.mockResolvedValue(undefined);

    await apiKeyService.revokeApiKey("user-1", "key-1");
    expect(mockRevoke).toHaveBeenCalledWith("user-1", "key-1");
  });
});
