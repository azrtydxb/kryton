// packages/core/src/tier2/__tests__/history.test.ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { HistoryFetcher } from "../history";

describe("HistoryFetcher", () => {
  it("returns cached results within TTL", async () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE tier2_cache_meta (entity_type TEXT NOT NULL, parent_id TEXT NOT NULL, fetched_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL, PRIMARY KEY (entity_type, parent_id));
      CREATE TABLE note_revision (id TEXT PRIMARY KEY, userId TEXT NOT NULL, notePath TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
    `);
    const fetchMock = vi.fn(async () => ({
      entities: [
        {
          id: "r1",
          userId: "u",
          notePath: "p1",
          content: "v1",
          createdAt: 1,
        },
      ],
    }));
    const h = new HistoryFetcher({
      db,
      fetchTier2: fetchMock as any,
      ttlMs: 60_000,
    });
    const a = await h.list("p1");
    const b = await h.list("p1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(b.map((r) => r.id)).toEqual(["r1"]);
  });

  it("fetches again after TTL expires", async () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE tier2_cache_meta (entity_type TEXT NOT NULL, parent_id TEXT NOT NULL, fetched_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL, PRIMARY KEY (entity_type, parent_id));
      CREATE TABLE note_revision (id TEXT PRIMARY KEY, userId TEXT NOT NULL, notePath TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
    `);
    const fetchMock = vi.fn(async () => ({
      entities: [
        { id: "r1", userId: "u", notePath: "p1", content: "v1", createdAt: 1 },
      ],
    }));
    const h = new HistoryFetcher({
      db,
      fetchTier2: fetchMock as any,
      ttlMs: 0, // expired immediately
    });
    await h.list("p1");
    await h.list("p1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
