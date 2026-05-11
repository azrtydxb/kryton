import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { noteTag, searchIndex } from "../../../../db/schema/notes.js";
import { TagService } from "../tag.service.js";
import { incrementCursor } from "../folder.service.js";

/** Parse tags from SearchIndex.tags field (stored as JSON array string). */
function parseTags(tagsField: string): string[] {
  if (!tagsField) return [];
  try {
    return JSON.parse(tagsField) as string[];
  } catch {
    return [];
  }
}

export async function backfillTags(
  app: FastifyInstance,
  userId: string,
): Promise<{ tags: number; links: number }> {
  const tagService = new TagService(app);

  const entries = await app.db.query.searchIndex.findMany({
    where: eq(searchIndex.userId, userId),
  });
  const allTagNames = new Set<string>();
  for (const e of entries) {
    for (const t of parseTags(e.tags)) allTagNames.add(t);
  }

  const tagRecords = new Map<string, { id: string }>();
  for (const name of allTagNames) {
    const t = await tagService.upsert(userId, name);
    tagRecords.set(name, t);
  }

  let linkCount = 0;
  for (const e of entries) {
    for (const name of parseTags(e.tags)) {
      const tagRow = tagRecords.get(name)!;
      const cursor = await incrementCursor(app, userId);
      // ON CONFLICT DO NOTHING gives us the "skip if exists" semantic from
      // the original Prisma findUnique + create dance.
      const inserted = await app.db
        .insert(noteTag)
        .values({
          userId,
          notePath: e.notePath,
          tagId: tagRow.id,
          version: 1,
          cursor,
        })
        .onConflictDoNothing({
          target: [noteTag.userId, noteTag.notePath, noteTag.tagId],
        })
        .returning({ tagId: noteTag.tagId });
      if (inserted.length > 0) {
        linkCount++;
      }
    }
  }
  return { tags: tagRecords.size, links: linkCount };
}
