import MiniSearch from "minisearch";
import type { FastifyInstance } from "fastify";
import {
  parseFrontmatter,
  parseTags,
  serializeTags,
  stripMarkdown,
  extractTags,
  extractTitle,
} from "./search-helpers.js";

interface SearchIndexRow {
  notePath: string;
  userId: string;
  title: string;
  content: string;
  tags: string;
  modifiedAt: Date;
}

export interface IndexedDocument {
  id: string; // notePath (unique within a user's index)
  title: string;
  content: string;
  tags: string;
  notePath: string;
}

const MAX_CACHED_INDICES = 50;

/**
 * Manages per-user MiniSearch indices. One instance per Fastify app — Prisma
 * is read off the Fastify decorator, no module-level singleton.
 */
export class SearchIndexManager {
  private readonly userIndices = new Map<string, MiniSearch<IndexedDocument>>();
  private readonly builtIndices = new Set<string>();
  private readonly lruOrder: string[] = [];

  constructor(private readonly app: FastifyInstance) {}

  private touchLru(userId: string): void {
    const idx = this.lruOrder.indexOf(userId);
    if (idx !== -1) this.lruOrder.splice(idx, 1);
    this.lruOrder.push(userId);

    while (this.lruOrder.length > MAX_CACHED_INDICES) {
      const evictId = this.lruOrder.shift()!;
      this.userIndices.delete(evictId);
      this.builtIndices.delete(evictId);
    }
  }

  getOrCreateIndex(userId: string): MiniSearch<IndexedDocument> {
    let index = this.userIndices.get(userId);
    if (!index) {
      index = new MiniSearch<IndexedDocument>({
        fields: ["title", "content", "tags"],
        storeFields: ["title", "notePath", "tags"],
        searchOptions: {
          boost: { title: 3, tags: 2 },
          fuzzy: 0.2,
          prefix: true,
        },
      });
      this.userIndices.set(userId, index);
    }
    this.touchLru(userId);
    return index;
  }

  hasBuilt(userId: string): boolean {
    return this.builtIndices.has(userId);
  }

  /**
   * Load all SearchIndex rows from Prisma for a user and populate the
   * MiniSearch index. Safe to call multiple times — skips users already built.
   */
  async buildIndex(userId: string): Promise<void> {
    if (this.builtIndices.has(userId)) return;

    const index = this.getOrCreateIndex(userId);
    const rows = await this.app.prisma.searchIndex.findMany({ where: { userId } });

    const docs: IndexedDocument[] = (rows as SearchIndexRow[]).map((r) => ({
      id: r.notePath,
      title: r.title,
      content: r.content,
      tags: parseTags(r.tags).join(" "),
      notePath: r.notePath,
    }));

    if (docs.length > 0) {
      index.addAll(docs);
    }

    this.builtIndices.add(userId);
  }

  /**
   * Index a note in the search database and the in-memory MiniSearch index.
   */
  async indexNote(notePath: string, content: string, userId: string): Promise<void> {
    const { frontmatter, body } = parseFrontmatter(content);
    const title = extractTitle(content, notePath);

    const plainContent = [
      stripMarkdown(body),
      ...(frontmatter ? Object.values(frontmatter) : []),
    ]
      .filter(Boolean)
      .join(" ");

    const inlineTags = extractTags(body);
    const frontmatterTags: string[] = frontmatter?.tags
      ? frontmatter.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const tags = [...new Set([...inlineTags, ...frontmatterTags])];

    await this.app.prisma.searchIndex.upsert({
      where: { notePath_userId: { notePath, userId } },
      create: {
        notePath,
        userId,
        title,
        content: plainContent,
        tags: serializeTags(tags),
        modifiedAt: new Date(),
      },
      update: {
        title,
        content: plainContent,
        tags: serializeTags(tags),
        modifiedAt: new Date(),
      },
    });

    if (this.builtIndices.has(userId)) {
      const index = this.getOrCreateIndex(userId);
      const doc: IndexedDocument = {
        id: notePath,
        title,
        content: plainContent,
        tags: tags.join(" "),
        notePath,
      };
      if (index.has(notePath)) {
        index.remove({ id: notePath } as IndexedDocument);
      }
      index.add(doc);
    }
  }

  /**
   * Remove a note from the search index (Prisma + in-memory).
   */
  async removeFromIndex(notePath: string, userId: string): Promise<void> {
    await this.app.prisma.searchIndex.deleteMany({ where: { notePath, userId } });

    if (this.builtIndices.has(userId)) {
      const index = this.userIndices.get(userId);
      if (index?.has(notePath)) {
        index.remove({ id: notePath } as IndexedDocument);
      }
    }
  }

  /**
   * Rename a note in the search index (Prisma + in-memory).
   */
  async renameInIndex(oldPath: string, newPath: string, userId: string): Promise<void> {
    const entry = await this.app.prisma.searchIndex.findUnique({
      where: { notePath_userId: { notePath: oldPath, userId } },
    });
    if (!entry) return;

    await this.app.prisma.searchIndex.delete({
      where: { notePath_userId: { notePath: oldPath, userId } },
    });
    await this.app.prisma.searchIndex.create({
      data: {
        notePath: newPath,
        userId,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        modifiedAt: entry.modifiedAt,
      },
    });

    if (this.builtIndices.has(userId)) {
      const index = this.userIndices.get(userId);
      if (index) {
        if (index.has(oldPath)) {
          index.remove({ id: oldPath } as IndexedDocument);
        }
        index.add({
          id: newPath,
          title: entry.title,
          content: entry.content,
          tags: parseTags(entry.tags).join(" "),
          notePath: newPath,
        });
      }
    }
  }
}
