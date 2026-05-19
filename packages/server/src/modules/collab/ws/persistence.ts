import * as Y from "yjs";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import { yjsDocument, yjsUpdate } from "../../../db/schema/collab.js";
import type { NoteService } from "../../notes/services/note.service.js";

/**
 * Resolves the per-user notes directory for a given userId. Injected so
 * the persistence layer doesn't have to know about the notes module's
 * internal layout helpers.
 */
export type NotesDirResolver = (userId: string) => Promise<string>;

export interface YjsPersistenceDeps {
  noteService: NoteService;
  resolveNotesDir: NotesDirResolver;
}

export class YjsPersistence {
  private readonly noteService: NoteService | null;
  private readonly resolveNotesDir: NotesDirResolver | null;

  constructor(private readonly db: Db, deps?: YjsPersistenceDeps) {
    this.noteService = deps?.noteService ?? null;
    this.resolveNotesDir = deps?.resolveNotesDir ?? null;
  }

  /**
   * Load a Yjs document from the database. Applies the stored snapshot
   * and replays any pending update log entries. Returns null if no
   * snapshot exists for this docId/userId pair.
   */
  async loadYjsDoc(docId: string, userId: string): Promise<Y.Doc | null> {
    const row = await this.db.query.yjsDocument.findFirst({
      where: eq(yjsDocument.docId, docId),
    });
    if (!row || row.userId !== userId) return null;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.snapshot);

    const updates = await this.db.query.yjsUpdate.findMany({
      where: eq(yjsUpdate.docId, docId),
      orderBy: asc(yjsUpdate.id),
    });
    for (const u of updates) {
      Y.applyUpdate(doc, u.update);
    }
    return doc;
  }

  /**
   * Persist the full document state as a snapshot and delete pending updates.
   */
  async saveYjsSnapshot(docId: string, userId: string, doc: Y.Doc): Promise<void> {
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
    const stateVector = Buffer.from(Y.encodeStateVector(doc));

    await this.db.transaction(async (tx) => {
      await tx
        .insert(yjsDocument)
        .values({ docId, userId, snapshot, stateVector })
        .onConflictDoUpdate({
          target: yjsDocument.docId,
          set: { snapshot, stateVector, updatedAt: new Date() },
        });
      await tx.delete(yjsUpdate).where(eq(yjsUpdate.docId, docId));
    });
  }

  /**
   * Write the current Y.Text("content") to the canonical `.md` file on
   * disk via `noteService.writeNote`, which keeps the search/graph
   * indexes fresh. `.md` is the source of truth; Y snapshots are an
   * editing-session cache.
   *
   * No-op when persistence was constructed without disk-flush deps
   * (legacy tests that exercise the DB layer in isolation).
   */
  async flushToDisk(docId: string, userId: string, doc: Y.Doc): Promise<void> {
    if (!this.noteService || !this.resolveNotesDir) return;
    const content = doc.getText("content").toString();
    const notesDir = await this.resolveNotesDir(userId);
    await this.noteService.writeNote(notesDir, docId, content, userId);
  }

  /**
   * Append an incremental update to the update log.
   */
  async appendYjsUpdate(
    docId: string,
    update: Uint8Array,
    agentId: string | null,
  ): Promise<void> {
    await this.db.insert(yjsUpdate).values({
      docId,
      update: Buffer.from(update),
      agentId,
    });
  }
}
