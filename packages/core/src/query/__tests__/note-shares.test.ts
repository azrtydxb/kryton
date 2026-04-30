// packages/core/src/query/__tests__/note-shares.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { NoteSharesRepository } from "../note-shares";
import { EventBus } from "../../events";

describe("NoteSharesRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE note_share (
      id TEXT PRIMARY KEY,
      ownerUserId TEXT NOT NULL,
      path TEXT NOT NULL,
      isFolder INTEGER NOT NULL,
      sharedWithUserId TEXT NOT NULL,
      permission TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new NoteSharesRepository(db, new EventBus());
    repo.create({
      id: "ns1", ownerUserId: "u1", path: "doc", isFolder: 0 as any,
      sharedWithUserId: "u2", permission: "read",
      createdAt: 0, updatedAt: 0, version: 0, cursor: 0,
    });
    expect(repo.findById("ns1")?.permission).toBe("read");
  });
});
