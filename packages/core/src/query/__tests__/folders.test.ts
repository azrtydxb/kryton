// packages/core/src/query/__tests__/folders.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { FoldersRepository } from "../folders";
import { EventBus } from "../../events";

describe("FoldersRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE folder (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      path TEXT NOT NULL,
      parentId TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new FoldersRepository(db, new EventBus());
    repo.create({ id: "f1", userId: "u", path: "a", parentId: null, updatedAt: 0, version: 0, cursor: 0 });
    expect(repo.findById("f1")?.path).toBe("a");
  });
});
