import { prisma } from "../../prisma.js";
import { upsertTag } from "../tag.js";
import { incrementCursor } from "../cursor.js";

/** Parse tags from SearchIndex.tags field (stored as JSON array string) */
function parseTags(tagsField: string): string[] {
  if (!tagsField) return [];
  try { return JSON.parse(tagsField); } catch { return []; }
}

export async function backfillTags(userId: string): Promise<{ tags: number; links: number }> {
  const entries = await prisma.searchIndex.findMany({ where: { userId } });
  const allTagNames = new Set<string>();
  for (const e of entries) {
    for (const t of parseTags(e.tags)) allTagNames.add(t);
  }

  const tagRecords = new Map<string, { id: string }>();
  for (const name of allTagNames) {
    const t = await upsertTag(userId, name);
    tagRecords.set(name, t);
  }

  let linkCount = 0;
  for (const e of entries) {
    for (const name of parseTags(e.tags)) {
      const tag = tagRecords.get(name)!;
      const existing = await prisma.noteTag.findUnique({
        where: { userId_notePath_tagId: { userId, notePath: e.notePath, tagId: tag.id } },
      });
      if (!existing) {
        const cursor = await incrementCursor(userId);
        await prisma.noteTag.create({
          data: { userId, notePath: e.notePath, tagId: tag.id, version: 1, cursor },
        });
        linkCount++;
      }
    }
  }
  return { tags: tagRecords.size, links: linkCount };
}
