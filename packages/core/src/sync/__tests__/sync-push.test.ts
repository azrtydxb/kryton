// packages/core/src/sync/__tests__/sync-push.test.ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { EventBus } from "../../events";
import { SyncOrchestrator } from "../sync";
import { LocalStorage } from "../../storage";
import { NotesRepository } from "../../query/notes";

describe("SyncOrchestrator.push", () => {
  it("pushes local creates and marks them synced", async () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE note (id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, tags TEXT NOT NULL, modifiedAt INTEGER NOT NULL, _local_status TEXT NOT NULL DEFAULT 'synced', _local_seq INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0);
    `);
    const bus = new EventBus();
    const storage = new LocalStorage(db);
    const notes = new NotesRepository(db, bus);
    notes.create({ id: "n", path: "p", title: "t", tags: "[]", modifiedAt: 0, version: 0 } as any);

    const httpClient = {
      pull: vi.fn(),
      push: vi.fn(async () => ({
        accepted: { notes: [{ id: "n", version: 5 }] },
        conflicts: [],
      })),
    } as any;

    const o = new SyncOrchestrator({ db, bus, storage, httpClient, repositories: { notes } });
    const result = await o.push();
    expect(result.pushed).toBe(1);
    expect(httpClient.push).toHaveBeenCalledOnce();
    const row = db.get<{ _local_status: string; version: number }>(
      "SELECT _local_status, version FROM note WHERE id=?", ["n"]
    );
    expect(row).toMatchObject({ _local_status: "synced", version: 5 });
  });

  it("emits conflict events for rejected updates", async () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE note (id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, tags TEXT NOT NULL, modifiedAt INTEGER NOT NULL, _local_status TEXT NOT NULL DEFAULT 'synced', _local_seq INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0);
    `);
    const bus = new EventBus();
    const storage = new LocalStorage(db);
    const notes = new NotesRepository(db, bus);
    db.run("INSERT INTO note (id, path, title, tags, modifiedAt, _local_status, version) VALUES (?, ?, ?, ?, ?, ?, ?)", ["n", "p", "old", "[]", 0, "updated", 1]);

    const httpClient = {
      pull: vi.fn(),
      push: vi.fn(async () => ({
        accepted: {},
        conflicts: [{ table: "notes", id: "n", current_version: 99, current_state: { id: "n", path: "p", title: "server", tags: "[]", modifiedAt: 100, version: 99 } }],
      })),
    } as any;

    const events: any[] = [];
    bus.on("sync:conflict" as any, (c: any) => events.push(c));

    const o = new SyncOrchestrator({ db, bus, storage, httpClient, repositories: { notes } });
    await o.push();
    expect(events).toHaveLength(1);
  });
});
