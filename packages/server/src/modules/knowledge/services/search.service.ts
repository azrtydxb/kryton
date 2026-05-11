import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { searchIndex } from "../../../db/schema/notes.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import {
  parseFrontmatter,
  serializeTags,
  stripMarkdown,
  extractTags,
  extractTitle,
} from "./search-helpers.js";
import {
  search as searchImpl,
  getAllTags as getAllTagsImpl,
  getNotesByTag as getNotesByTagImpl,
  type SearchResult,
} from "./search-query.js";

export type { SearchResult } from "./search-query.js";

/**
 * Knowledge search service. Thin wrapper around Drizzle reads/writes against
 * `SearchIndex`. The `tsv` column is a generated tsvector maintained by
 * Postgres; there's no in-memory index to keep in sync.
 */
export class SearchService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Upsert a note's row in SearchIndex. The generated `tsv` column updates
   * automatically.
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

    const now = new Date();
    await this.app.db
      .insert(searchIndex)
      .values({
        notePath,
        userId,
        title,
        content: plainContent,
        tags: serializeTags(tags),
        modifiedAt: now,
      })
      .onConflictDoUpdate({
        target: [searchIndex.notePath, searchIndex.userId],
        set: {
          title,
          content: plainContent,
          tags: serializeTags(tags),
          modifiedAt: now,
        },
      });

    await this.enqueueEmbedJob(userId, notePath, "upsert");
  }

  async removeFromIndex(notePath: string, userId: string): Promise<void> {
    await this.app.db
      .delete(searchIndex)
      .where(
        and(eq(searchIndex.notePath, notePath), eq(searchIndex.userId, userId)),
      );

    await this.enqueueEmbedJob(userId, notePath, "delete");
  }

  async renameInIndex(oldPath: string, newPath: string, userId: string): Promise<void> {
    const existing = await this.app.db
      .select()
      .from(searchIndex)
      .where(
        and(eq(searchIndex.notePath, oldPath), eq(searchIndex.userId, userId)),
      )
      .limit(1);
    if (existing.length === 0) return;
    const entry = existing[0];

    await this.app.db
      .delete(searchIndex)
      .where(
        and(eq(searchIndex.notePath, oldPath), eq(searchIndex.userId, userId)),
      );
    await this.app.db.insert(searchIndex).values({
      notePath: newPath,
      userId,
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      modifiedAt: entry.modifiedAt,
    });

    await this.enqueueEmbedJob(userId, oldPath, "delete");
    await this.enqueueEmbedJob(userId, newPath, "upsert");
  }

  /**
   * Enqueue an async embed job for the given note. Skipped when the embedder
   * is disabled (SEMANTIC_PROVIDER=off) — saves a write the worker would
   * never drain. ON CONFLICT (userId, notePath) DO UPDATE coalesces repeat
   * writes for the same note into a single queued row.
   */
  private async enqueueEmbedJob(
    userId: string,
    notePath: string,
    op: "upsert" | "delete",
  ): Promise<void> {
    if (this.app.embedderState?.provider === "off") return;

    await this.app.db
      .insert(embedJob)
      .values({ userId, notePath, op, attempts: 0 })
      .onConflictDoUpdate({
        target: [embedJob.userId, embedJob.notePath],
        set: {
          op,
          enqueuedAt: sql`NOW()`,
          attempts: 0,
          error: null,
        },
      });
  }

  search(query: string, userId: string): Promise<SearchResult[]> {
    return searchImpl(this.app, query, userId);
  }

  getAllTags(userId: string): Promise<{ tag: string; count: number }[]> {
    return getAllTagsImpl(this.app, userId);
  }

  getNotesByTag(
    tag: string,
    userId: string,
  ): Promise<{ notePath: string; title: string }[]> {
    return getNotesByTagImpl(this.app, tag, userId);
  }
}
