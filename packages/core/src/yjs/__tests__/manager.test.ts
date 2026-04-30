// packages/core/src/yjs/__tests__/manager.test.ts
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { YjsManager } from "../manager";

function makeDb() {
  const db = new InMemoryAdapter();
  db.exec(`
    CREATE TABLE yjs_documents (doc_id TEXT PRIMARY KEY, snapshot BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE yjs_pending_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, update_data BLOB NOT NULL, created_at INTEGER NOT NULL);
  `);
  return db;
}

describe("YjsManager", () => {
  it("openDocument refcounts (same doc returned for same id)", async () => {
    const db = makeDb();
    const m = new YjsManager({
      db,
      wsUrl: () => "ws://example/ws/yjs",
      authToken: () => "T",
      wsFactory: () =>
        ({ readyState: 1, send: () => {}, close: () => {} }) as any,
    });
    const a = await m.openDocument("d1");
    const b = await m.openDocument("d1");
    expect(a).toBe(b);
    await m.closeDocument("d1");
    await m.closeDocument("d1");
  });

  it("closeDocument persists a snapshot and cleans up", async () => {
    const db = makeDb();
    const m = new YjsManager({
      db,
      wsUrl: () => "ws://example/ws/yjs",
      authToken: () => "T",
      wsFactory: () =>
        ({ readyState: 1, send: () => {}, close: () => {} }) as any,
    });
    const doc = await m.openDocument("d2");
    doc.getText("body").insert(0, "hello");
    await m.closeDocument("d2");
    // The snapshot should now be in the DB
    const row = db.get<{ snapshot: Buffer }>(
      "SELECT snapshot FROM yjs_documents WHERE doc_id = ?",
      ["d2"],
    );
    expect(row).toBeDefined();
  });

  it("getAwareness returns null for unknown docId", async () => {
    const db = makeDb();
    const m = new YjsManager({
      db,
      wsUrl: () => "ws://example/ws/yjs",
      authToken: () => "T",
      wsFactory: () =>
        ({ readyState: 1, send: () => {}, close: () => {} }) as any,
    });
    expect(m.getAwareness("nonexistent")).toBeNull();
  });

  it("closeAll closes every open document", async () => {
    const db = makeDb();
    const closedSpy = vi.fn();
    const m = new YjsManager({
      db,
      wsUrl: () => "ws://example/ws/yjs",
      authToken: () => "T",
      wsFactory: () =>
        ({ readyState: 1, send: () => {}, close: closedSpy }) as any,
    });
    await m.openDocument("da");
    await m.openDocument("db");
    await m.closeAll();
    expect(closedSpy).toHaveBeenCalledTimes(2);
  });
});
