// packages/core/src/query/__tests__/graph-edges.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { GraphEdgesRepository } from "../graph-edges";
import { EventBus } from "../../events";

describe("GraphEdgesRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE graph_edge (
      id TEXT PRIMARY KEY,
      fromPath TEXT NOT NULL,
      toPath TEXT NOT NULL,
      fromNoteId TEXT NOT NULL,
      toNoteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new GraphEdgesRepository(db, new EventBus());
    repo.create({
      id: "ge1", fromPath: "a", toPath: "b",
      fromNoteId: "n1", toNoteId: "n2",
      userId: "u1", version: 0, cursor: 0,
    });
    expect(repo.findById("ge1")?.fromPath).toBe("a");
  });
});
