import type { FastifyInstance } from "fastify";
import { incrementCursor } from "./folder.service.js";

export class TagService {
  constructor(private readonly app: FastifyInstance) {}

  async upsert(userId: string, name: string) {
    const cursor = await incrementCursor(this.app, userId);
    return this.app.prisma.tag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name, version: 1, cursor },
    });
  }

  async listNoteTags(userId: string, notePath: string): Promise<string[]> {
    const rows = await this.app.prisma.noteTag.findMany({
      where: { userId, notePath },
      include: { tag: true },
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
      const tag = await this.upsert(userId, name);
      const cursor = await incrementCursor(this.app, userId);
      await this.app.prisma.noteTag.upsert({
        where: { userId_notePath_tagId: { userId, notePath, tagId: tag.id } },
        update: {},
        create: { userId, notePath, tagId: tag.id, version: 1, cursor },
      });
    }
    return union;
  }
}
