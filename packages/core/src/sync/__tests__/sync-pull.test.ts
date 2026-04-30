// packages/core/src/sync/__tests__/sync-pull.test.ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { EventBus } from "../../events";
import { SyncOrchestrator } from "../sync";
import { LocalStorage } from "../../storage";
import { NotesRepository } from "../../query/notes";

describe("SyncOrchestrator.pull", () => {
  it("applies changes and advances cursor", async () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE note (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        tags TEXT NOT NULL,
        modifiedAt INTEGER NOT NULL,
        _local_status TEXT NOT NULL DEFAULT 'synced',
        _local_seq INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0
      );
    `);
    const bus = new EventBus();
    const storage = new LocalStorage(db);
    const notes = new NotesRepository(db, bus);

    const httpClient = {
      pull: vi.fn(async (cursor: string) => ({
        cursor: "10",
        changes: {
          notes: {
            created: [{ id: "n1", path: "p", title: "t", tags: "[]", modifiedAt: 1, version: 1 }],
            updated: [],
            deleted: [],
          },
        },
      })),
      push: vi.fn(),
    } as any;

    const orchestrator = new SyncOrchestrator({
      db, bus, storage, httpClient,
      repositories: { notes },
    });

    await orchestrator.pull();
    expect(httpClient.pull).toHaveBeenCalledWith("0");
    expect(storage.get("server_cursor", "")).toBe("10");
    expect(notes.findByPath("p")).toMatchObject({ title: "t" });
  });
});
