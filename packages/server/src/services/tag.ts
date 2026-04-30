import { prisma } from "../prisma.js";
import { incrementCursor } from "./cursor.js";

export async function upsertTag(userId: string, name: string) {
  const cursor = await incrementCursor(userId);
  return prisma.tag.upsert({
    where: { userId_name: { userId, name } },
    update: {},
    create: { userId, name, version: 1, cursor },
  });
}

export async function listNoteTags(userId: string, notePath: string): Promise<string[]> {
  const rows = await prisma.noteTag.findMany({
    where: { userId, notePath },
    include: { tag: true },
  });
  return rows.map(r => r.tag.name);
}

export async function mergeNoteTagSet(userId: string, notePath: string, addTags: string[]): Promise<string[]> {
  const existing = await listNoteTags(userId, notePath);
  const union = Array.from(new Set([...existing, ...addTags]));
  // Apply additions
  for (const name of addTags) {
    const tag = await upsertTag(userId, name);
    const cursor = await incrementCursor(userId);
    await prisma.noteTag.upsert({
      where: { userId_notePath_tagId: { userId, notePath, tagId: tag.id } },
      update: {},
      create: { userId, notePath, tagId: tag.id, version: 1, cursor },
    });
  }
  return union;
}
