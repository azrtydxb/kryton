// packages/core/src/sync/__tests__/http-pull.test.ts
import { describe, it, expect, vi } from "vitest";
import { HttpSyncClient } from "../http";

describe("HttpSyncClient.pull", () => {
  it("POSTs cursor and returns response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cursor: "100",
        changes: { settings: { created: [], updated: [], deleted: [] } },
      }),
    }));
    const c = new HttpSyncClient({
      serverUrl: "https://srv",
      authToken: () => "T",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const r = await c.pull("50");
    expect(r.cursor).toBe("100");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://srv/api/sync/v2/pull",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer T",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ cursor: "50" }),
      })
    );
  });

  it("throws KrytonAuthError on 401", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, text: async () => "no" }));
    const c = new HttpSyncClient({
      serverUrl: "https://srv",
      authToken: () => "T",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(c.pull("0")).rejects.toThrow(/401/);
  });

  it("throws retryable KrytonSyncError on 5xx", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, text: async () => "down" }));
    const c = new HttpSyncClient({
      serverUrl: "https://srv",
      authToken: () => "T",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(c.pull("0")).rejects.toMatchObject({ retryable: true });
  });
});
