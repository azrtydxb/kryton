// packages/core/src/query/__tests__/tags.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { TagsRepository } from "../tags";
import { EventBus } from "../../events";

describe("TagsRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE tag (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new TagsRepository(db, new EventBus());
    repo.create({ id: "t1", userId: "u", name: "work", color: "#ff0", updatedAt: 0, version: 0, cursor: 0 });
    expect(repo.findById("t1")?.name).toBe("work");
  });
});
