// packages/core/src/yjs/__tests__/read-content.test.ts
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { YjsStorage } from "../storage";
import { readYjsContent } from "../read-content";

describe("readYjsContent", () => {
  it("returns the Yjs body text from a stored snapshot", () => {
    const db = new InMemoryAdapter();
    db.exec(
      `CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);`,
    );
    const storage = new YjsStorage(db);
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "hello world");
    storage.save("d1", doc);

    expect(readYjsContent(db, "d1")).toBe("hello world");
  });

  it("returns null for a missing snapshot", () => {
    const db = new InMemoryAdapter();
    db.exec(
      `CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);`,
    );
    expect(readYjsContent(db, "nonexistent")).toBeNull();
  });

  it("reads a custom field name", () => {
    const db = new InMemoryAdapter();
    db.exec(
      `CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);`,
    );
    const storage = new YjsStorage(db);
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "My Title");
    storage.save("d1", doc);

    expect(readYjsContent(db, "d1", "title")).toBe("My Title");
  });
});
