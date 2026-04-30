// packages/core/src/yjs/__tests__/storage.test.ts
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { YjsStorage } from "../storage";

describe("YjsStorage", () => {
  it("save and load round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);`);
    const s = new YjsStorage(db);
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "hello");
    s.save("d1", doc);
    const loaded = s.load("d1");
    expect(loaded?.getText("body").toString()).toBe("hello");
  });

  it("returns null when doc not present", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);`);
    const s = new YjsStorage(db);
    expect(s.load("missing")).toBeNull();
  });

  it("appendUpdate buffers updates between snapshots", () => {
    const db = new InMemoryAdapter();
    db.exec(`
      CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE yjs_pending_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, update_data BLOB NOT NULL, created_at INTEGER NOT NULL);
    `);
    const s = new YjsStorage(db);
    s.appendUpdate("d1", new Uint8Array([1, 2, 3]));
    expect(s.takePendingUpdates("d1")).toHaveLength(1);
    expect(s.takePendingUpdates("d1")).toHaveLength(0);
  });
});
