import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import * as Y from "yjs";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import { user as userTable } from "../../../db/schema/auth.js";
import { yjsDocument, yjsUpdate } from "../../../db/schema/collab.js";
import { YjsPersistence } from "../ws/persistence.js";

/**
 * Phase 5.6 / Phase 7 sanity check: Yjs binary state round-trips through
 * Drizzle's `bytea` custom type (pg Buffer) byte-for-byte, including non-
 * trivial payloads (>100 KB). This guards against any future change to the
 * bytea encoder/decoder that would silently corrupt collaborative state.
 */
describe("yjs bytea round-trip (Drizzle)", () => {
  let handle: TestDbHandle;
  let persistence: YjsPersistence;
  let userId: string;

  beforeAll(() => {
    handle = createTestDb();
    persistence = new YjsPersistence(handle.db);
  });

  afterAll(async () => {
    // Leave the DB clean so other test files relying on empty tables pass.
    await handle.db.execute(sql`
      TRUNCATE TABLE "YjsUpdate", "YjsDocument", "User" RESTART IDENTITY CASCADE
    `);
    await handle.close();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`
      TRUNCATE TABLE "YjsUpdate", "YjsDocument", "User" RESTART IDENTITY CASCADE
    `);
    userId = `u-bytea-${Date.now()}-${Math.random()}`;
    await handle.db.insert(userTable).values({
      id: userId,
      email: `${userId}@test.local`,
      name: "Bytea Test",
      emailVerified: false,
    });
  });

  it("round-trips a >100 KB Yjs snapshot byte-for-byte", async () => {
    // Build a Y.Doc with enough content that the encoded state exceeds 100 KB.
    const doc = new Y.Doc();
    const text = doc.getText("t");
    // ~120 KB of repetitive but valid UTF-8 text.
    const chunk = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
    for (let i = 0; i < 2500; i++) {
      text.insert(text.length, chunk);
    }
    const encoded = Y.encodeStateAsUpdate(doc);
    expect(encoded.byteLength).toBeGreaterThan(100 * 1024);

    const docId = `bytea-doc-${Date.now()}`;
    await persistence.saveYjsSnapshot(docId, userId, doc);

    // Verify raw bytes in storage match exactly.
    const stored = await handle.db.query.yjsDocument.findFirst({
      where: eq(yjsDocument.docId, docId),
    });
    expect(stored).toBeTruthy();
    expect(stored!.snapshot).toBeInstanceOf(Buffer);
    expect(stored!.snapshot.length).toBe(encoded.byteLength);
    expect(Buffer.from(encoded).equals(stored!.snapshot)).toBe(true);

    // Verify Yjs can faithfully reconstruct the document.
    const loaded = await persistence.loadYjsDoc(docId, userId);
    expect(loaded).not.toBeNull();
    expect(loaded!.getText("t").toString()).toBe(text.toString());
  });

  it("round-trips an incremental yjsUpdate byte-for-byte", async () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "hello world");
    const update = Y.encodeStateAsUpdate(doc);

    const docId = `bytea-upd-${Date.now()}`;
    await persistence.appendYjsUpdate(docId, update, null);

    const rows = await handle.db.query.yjsUpdate.findMany({
      where: eq(yjsUpdate.docId, docId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].update).toBeInstanceOf(Buffer);
    expect(Buffer.from(update).equals(rows[0].update)).toBe(true);
  });
});
