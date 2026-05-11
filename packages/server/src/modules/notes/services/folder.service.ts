import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { folder } from "../../../db/schema/notes.js";
import { syncCursor } from "../../../db/schema/sync.js";

/**
 * Increment the per-user sync cursor and return the new value.
 * Local copy of the legacy cursor service — kept inside the notes module so it
 * has no module-level Prisma singleton.
 */
async function incrementCursor(app: FastifyInstance, userId: string): Promise<bigint> {
  const [row] = await app.db
    .insert(syncCursor)
    .values({ userId, cursor: 1n })
    .onConflictDoUpdate({
      target: syncCursor.userId,
      set: { cursor: sql`${syncCursor.cursor} + 1` },
    })
    .returning({ cursor: syncCursor.cursor });
  return row.cursor;
}

export class FolderService {
  constructor(private readonly app: FastifyInstance) {}

  async create(userId: string, input: { path: string; parentPath?: string }) {
    const cursor = await incrementCursor(this.app, userId);
    const parent = input.parentPath
      ? await this.app.db.query.folder.findFirst({
          where: and(eq(folder.userId, userId), eq(folder.path, input.parentPath)),
        })
      : null;
    const [created] = await this.app.db
      .insert(folder)
      .values({
        userId,
        path: input.path,
        parentId: parent?.id ?? null,
        version: 1,
        cursor,
      })
      .returning();
    return created;
  }

  async list(userId: string) {
    return this.app.db.query.folder.findMany({
      where: eq(folder.userId, userId),
      orderBy: asc(folder.path),
    });
  }

  async delete(userId: string, folderId: string): Promise<unknown> {
    // Recursively delete children first (FK is SET NULL, not CASCADE)
    const children = await this.app.db.query.folder.findMany({
      where: and(eq(folder.userId, userId), eq(folder.parentId, folderId)),
    });
    for (const child of children) {
      await this.delete(userId, child.id);
    }
    const [deleted] = await this.app.db
      .delete(folder)
      .where(eq(folder.id, folderId))
      .returning();
    return deleted;
  }
}

export { incrementCursor };
