import type { FastifyInstance } from "fastify";

/**
 * Increment the per-user sync cursor and return the new value.
 * Local copy of the legacy cursor service — kept inside the notes module so it
 * has no module-level Prisma singleton.
 */
async function incrementCursor(app: FastifyInstance, userId: string): Promise<bigint> {
  const result = await app.prisma.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return result.cursor;
}

export class FolderService {
  constructor(private readonly app: FastifyInstance) {}

  async create(userId: string, input: { path: string; parentPath?: string }) {
    const cursor = await incrementCursor(this.app, userId);
    const parent = input.parentPath
      ? await this.app.prisma.folder.findUnique({
          where: { userId_path: { userId, path: input.parentPath } },
        })
      : null;
    return this.app.prisma.folder.create({
      data: {
        userId,
        path: input.path,
        parentId: parent?.id ?? null,
        version: 1,
        cursor,
      },
    });
  }

  async list(userId: string) {
    return this.app.prisma.folder.findMany({
      where: { userId },
      orderBy: { path: "asc" },
    });
  }

  async delete(userId: string, folderId: string): Promise<unknown> {
    // Recursively delete children first (FK is SET NULL, not CASCADE)
    const children = await this.app.prisma.folder.findMany({
      where: { userId, parentId: folderId },
    });
    for (const child of children) {
      await this.delete(userId, child.id);
    }
    return this.app.prisma.folder.delete({ where: { id: folderId } });
  }
}

export { incrementCursor };
