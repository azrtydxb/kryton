// packages/core/src/yjs/read-content.ts
//
// Standalone helper: reads the "body" Yjs text from a stored snapshot.
// At merge time, Stream 2A wires this into NotesRepository.readContent().
//
import * as Y from "yjs";
import type { SqliteAdapter } from "../adapter";

/**
 * Returns the plain-text content of the Yjs document stored under `docId`,
 * reading the "body" Y.Text. Returns null if no snapshot is found.
 *
 * This is intentionally a pure function so it can be used outside of
 * YjsManager (i.e., without an open WebSocket connection).
 */
export function readYjsContent(
  db: SqliteAdapter,
  docId: string,
  field = "body",
): string | null {
  const row = db.get<{ snapshot: Buffer }>(
    "SELECT snapshot FROM yjs_documents WHERE doc_id = ?",
    [docId],
  );
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.snapshot));
  return doc.getText(field).toString();
}
