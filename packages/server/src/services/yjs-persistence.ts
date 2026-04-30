import * as Y from "yjs";
import { prisma } from "../prisma.js";

/**
 * Load a Yjs document from the database.
 * Applies the stored snapshot and then replays any pending update log entries.
 */
export async function loadYjsDoc(docId: string, userId: string): Promise<Y.Doc | null> {
  const row = await prisma.yjsDocument.findUnique({ where: { docId } });
  if (!row || row.userId !== userId) return null;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.snapshot);

  const updates = await prisma.yjsUpdate.findMany({
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
 * This compacts the update log.
 */
export async function saveYjsSnapshot(docId: string, userId: string, doc: Y.Doc): Promise<void> {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
  const stateVector = Buffer.from(Y.encodeStateVector(doc));

  await prisma.$transaction([
    prisma.yjsDocument.upsert({
      where: { docId },
      update: { snapshot, stateVector },
      create: { docId, userId, snapshot, stateVector },
    }),
    prisma.yjsUpdate.deleteMany({ where: { docId } }),
  ]);
}

/**
 * Append an incremental update to the update log.
 */
export async function appendYjsUpdate(
  docId: string,
  update: Uint8Array,
  agentId: string | null,
): Promise<void> {
  await prisma.yjsUpdate.create({
    data: { docId, update: Buffer.from(update), agentId },
  });
}
