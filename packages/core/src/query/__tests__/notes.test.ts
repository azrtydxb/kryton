// packages/core/src/query/__tests__/notes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { NotesRepository } from "../notes";
import { EventBus } from "../../events";

describe("NotesRepository", () => {
  let db: InMemoryAdapter; let bus: any; let repo: NotesRepository;

  beforeEach(() => {
    db = new InMemoryAdapter();
    db.exec(`CREATE TABLE note (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      tags TEXT NOT NULL,
      modifiedAt INTEGER NOT NULL,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0
    )`);
    bus = new EventBus();
    repo = new NotesRepository(db, bus);
  });

  it("findByPath returns matching note", () => {
    repo.create({ id: "p", path: "p", title: "t", tags: "[]", modifiedAt: 0, version: 0 } as any);
    expect(repo.findByPath("p")?.title).toBe("t");
  });

  it("listByFolder returns notes under a path prefix", () => {
    repo.create({ id: "a/n1", path: "a/n1", title: "1", tags: "[]", modifiedAt: 1, version: 0 } as any);
    repo.create({ id: "a/n2", path: "a/n2", title: "2", tags: "[]", modifiedAt: 2, version: 0 } as any);
    repo.create({ id: "b/n1", path: "b/n1", title: "3", tags: "[]", modifiedAt: 3, version: 0 } as any);
    const inA = repo.listByFolder("a/");
    expect(inA.map(n => n.path).sort()).toEqual(["a/n1", "a/n2"]);
  });
});
