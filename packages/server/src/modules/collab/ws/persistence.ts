import * as Y from "yjs";
import type { PrismaClient } from "../../../generated/prisma/client.js";

export class YjsPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Load a Yjs document from the database. Applies the stored snapshot
   * and replays any pending update log entries. Returns null if no
   * snapshot exists for this docId/userId pair.
   */
  async loadYjsDoc(docId: string, userId: string): Promise<Y.Doc | null> {
    const row = await this.prisma.yjsDocument.findUnique({ where: { docId } });
    if (!row || row.userId !== userId) return null;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.snapshot);

    const updates = await this.prisma.yjsUpdate.findMany({
      where: { docId },
      orderBy: { id: "asc" },
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

    await this.prisma.$transaction([
      this.prisma.yjsDocument.upsert({
        where: { docId },
        update: { snapshot, stateVector },
        create: { docId, userId, snapshot, stateVector },
      }),
      this.prisma.yjsUpdate.deleteMany({ where: { docId } }),
    ]);
  }

  /**
   * Append an incremental update to the update log.
   */
  async appendYjsUpdate(
    docId: string,
    update: Uint8Array,
    agentId: string | null,
  ): Promise<void> {
    await this.prisma.yjsUpdate.create({
      data: { docId, update: Buffer.from(update), agentId },
    });
  }
}
