import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { noteTag, tag } from "../../../db/schema/notes.js";

export class TagService {
  constructor(private readonly app: FastifyInstance) {}

  async upsert(userId: string, name: string) {
    // Drizzle has no Postgres-compatible "upsert + return existing without
    // updating" — emulate with INSERT ... ON CONFLICT DO UPDATE on a column
    // (set userId to itself to make it a no-op-write that still RETURNING-s).
    const [row] = await this.app.db
      .insert(tag)
      .values({ userId, name, version: 1 })
      .onConflictDoUpdate({
        target: [tag.userId, tag.name],
        set: { userId: tag.userId },
      })
      .returning();
    return row;
  }

  async listNoteTags(userId: string, notePath: string): Promise<string[]> {
    const rows = await this.app.db.query.noteTag.findMany({
      where: and(eq(noteTag.userId, userId), eq(noteTag.notePath, notePath)),
      with: { tag: true },
    });
    return rows.map((r) => r.tag.name);
  }

  async mergeNoteTagSet(
    userId: string,
    notePath: string,
    addTags: string[],
  ): Promise<string[]> {
    const existing = await this.listNoteTags(userId, notePath);
    const union = Array.from(new Set([...existing, ...addTags]));
    for (const name of addTags) {
      const tagRow = await this.upsert(userId, name);
      await this.app.db
        .insert(noteTag)
        .values({ userId, notePath, tagId: tagRow.id, version: 1 })
        .onConflictDoNothing({ target: [noteTag.userId, noteTag.notePath, noteTag.tagId] });
    }
    return union;
  }
}
