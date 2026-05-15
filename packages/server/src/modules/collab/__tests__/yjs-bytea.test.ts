import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
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
 *
 * Per-suite unique userId + docId so this file is safe under
 * fileParallelism: true. Cleanup uses scoped DELETE (FK cascade through
 * User) — no TRUNCATE.
 */
describe("yjs bytea round-trip (Drizzle)", () => {
  let handle: TestDbHandle;
  let persistence: YjsPersistence;
  // Satisfies SAFE_USER_ID_REGEX in services/user-notes-dir.service.ts.
  const userId = `u-bytea-${Math.floor(Math.random() * 1e9)}-${process.pid}`;

  beforeAll(async () => {
    handle = createTestDb();
    persistence = new YjsPersistence(handle.db);
    await handle.db.insert(userTable).values({
      id: userId,
      email: `${userId}@test.local`,
      name: "Bytea Test",
      emailVerified: false,
    });
  });

  afterAll(async () => {
    // FK cascade removes YjsDocument / YjsUpdate rows owned by this user.
    await handle.db.delete(userTable).where(eq(userTable.id, userId));
    await handle.close();
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

    const docId = `bytea-doc-${Math.floor(Math.random() * 1e9)}-${process.pid}`;
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

    const docId = `bytea-upd-${Math.floor(Math.random() * 1e9)}-${process.pid}`;
    await persistence.appendYjsUpdate(docId, update, null);

    const rows = await handle.db.query.yjsUpdate.findMany({
      where: eq(yjsUpdate.docId, docId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].update).toBeInstanceOf(Buffer);
    expect(Buffer.from(update).equals(rows[0].update)).toBe(true);
  });
});
