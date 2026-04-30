// packages/core/src/__tests__/integration/sync-full.test.ts
// Integration test: full sync round-trip (pull then push) with in-memory adapter.
import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { EventBus } from "../../events";
import { LocalStorage } from "../../storage";
import { NotesRepository } from "../../query/notes";
import { SyncOrchestrator } from "../../sync/sync";

const NOTE_TABLE_DDL = `
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
`;

describe("full sync round-trip", () => {
  it("pull then push syncs bidirectional changes", async () => {
    const db = new InMemoryAdapter();
    db.exec(NOTE_TABLE_DDL);
    const bus = new EventBus();
    const storage = new LocalStorage(db);
    const notes = new NotesRepository(db, bus);

    // Pre-seed a local change to be pushed
    notes.create({ id: "local-1", path: "local/note", title: "local title", tags: "[]", modifiedAt: 100, version: 0 } as any);

    const pullResponse = {
      cursor: "42",
      changes: {
        notes: {
          created: [{ id: "server-1", path: "server/note", title: "server title", tags: "[]", modifiedAt: 200, version: 5 }],
          updated: [],
          deleted: [],
        },
      },
    };

    const pullFn = vi.fn(async () => pullResponse);
    const pushFn = vi.fn(async () => ({
      accepted: { notes: [{ id: "local-1", version: 1 }] },
      conflicts: [],
    }));

    const orchestrator = new SyncOrchestrator({
      db, bus, storage,
      httpClient: { pull: pullFn, push: pushFn },
      repositories: { notes },
    });

    // Pull: server changes land locally
    await orchestrator.pull();
    expect(storage.get("server_cursor", "")).toBe("42");
    expect(notes.findByPath("server/note")).toMatchObject({ title: "server title", version: 5 });

    // Push: local create gets marked synced
    const pushResult = await orchestrator.push();
    expect(pushResult.pushed).toBe(1);
    const localNote = db.get<{ _local_status: string; version: number }>(
      "SELECT _local_status, version FROM note WHERE id=?", ["local-1"]
    );
    expect(localNote).toMatchObject({ _local_status: "synced", version: 1 });
  });

  it("conflict events are emitted when server rejects a push", async () => {
    const db = new InMemoryAdapter();
    db.exec(NOTE_TABLE_DDL);
    const bus = new EventBus();
    const storage = new LocalStorage(db);
    const notes = new NotesRepository(db, bus);

    // Pre-seed an "updated" local row (simulating an existing note that was modified locally)
    db.run(
      `INSERT INTO note (id, path, title, tags, modifiedAt, _local_status, _local_seq, version)
       VALUES (?, ?, ?, ?, ?, 'updated', 1, 2)`,
      ["conflict-1", "conflict/note", "my local change", "[]", 300]
    );

    const conflicts: any[] = [];
    bus.on("sync:conflict" as any, (c: any) => conflicts.push(c));

    const orchestrator = new SyncOrchestrator({
      db, bus, storage,
      httpClient: {
        pull: vi.fn(async () => ({ cursor: "0", changes: {} })),
        push: vi.fn(async () => ({
          accepted: {},
          conflicts: [{
            table: "notes",
            id: "conflict-1",
            current_version: 99,
            current_state: { id: "conflict-1", path: "conflict/note", title: "server wins", tags: "[]", modifiedAt: 999, version: 99 },
          }],
        })),
      },
      repositories: { notes },
    });

    await orchestrator.push();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe("conflict-1");
  });
});
