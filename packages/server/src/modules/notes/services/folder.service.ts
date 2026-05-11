import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { folder } from "../../../db/schema/notes.js";

export class FolderService {
  constructor(private readonly app: FastifyInstance) {}

  async create(userId: string, input: { path: string; parentPath?: string }) {
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
