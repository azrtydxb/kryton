// packages/core/src/query/__tests__/trash-items.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { TrashItemsRepository } from "../trash-items";
import { EventBus } from "../../events";

describe("TrashItemsRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE trash_item (
      id TEXT PRIMARY KEY,
      originalPath TEXT NOT NULL,
      userId TEXT NOT NULL,
      trashedAt INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new TrashItemsRepository(db, new EventBus());
    repo.create({ id: "ti1", originalPath: "doc/note", userId: "u1", trashedAt: 0, version: 0, cursor: 0 });
    expect(repo.findById("ti1")?.originalPath).toBe("doc/note");
  });
});
