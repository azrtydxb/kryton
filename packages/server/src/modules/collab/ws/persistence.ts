import * as Y from "yjs";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import { yjsDocument, yjsUpdate } from "../../../db/schema/collab.js";

export class YjsPersistence {
  constructor(private readonly db: Db) {}

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
