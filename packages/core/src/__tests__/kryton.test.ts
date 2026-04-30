// packages/core/src/__tests__/kryton.test.ts
import { describe, it, expect, vi } from "vitest";
import { Kryton } from "../kryton";
import { InMemoryAdapter } from "../adapters/in-memory";

describe("Kryton.init", () => {
  it("returns a working core with notes repository", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/version")) {
        return {
          ok: true,
          json: async () => ({
            apiVersion: "2.0.0",
            schemaVersion: "4.4.0",
            supportedClientRange: ">=4.4.0",
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const core = await Kryton.init({
      adapter: new InMemoryAdapter(),
      serverUrl: "https://srv",
      authToken: () => "T",
      fetch: fetchMock as any,
      schema: `
        CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS note (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          title TEXT NOT NULL,
          tags TEXT NOT NULL,
          modifiedAt INTEGER NOT NULL,
          _local_status TEXT NOT NULL DEFAULT 'synced',
          _local_seq INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 0
        );
      `,
    });

    core.notes.create({ id: "n", path: "p", title: "t", tags: "[]", modifiedAt: 0, version: 0 } as any);
    expect(core.notes.findByPath("p")?.title).toBe("t");
    await core.close();
  });

  it("throws when server version is incompatible", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        apiVersion: "2.0.0",
        schemaVersion: "4.4.0",
        supportedClientRange: ">=5.0.0", // our version 4.4.0 won't satisfy
      }),
    }));

    await expect(
      Kryton.init({
        adapter: new InMemoryAdapter(),
        serverUrl: "https://srv",
        authToken: () => "T",
        fetch: fetchMock as any,
        schema: `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
      })
    ).rejects.toThrow(/not in server's supported range/);
  });
});
