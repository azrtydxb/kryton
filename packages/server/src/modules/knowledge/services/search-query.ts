import type { FastifyInstance } from "fastify";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { searchIndex } from "../../../db/schema/notes.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { parseTags, createSnippet } from "./search-helpers.js";

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  modifiedAt: Date;
  isShared?: boolean;
  ownerUserId?: string;
  /** Relevance score. ts_rank for lexical, cosine similarity for semantic. */
  score?: number;
  /** Index of the best-matching chunk (semantic only). */
  chunkIndex?: number;
}

interface IndexRow {
  notePath: string;
  userId: string;
  title: string;
  content: string;
  tags: string;
  modifiedAt: Date;
  rank?: number;
}

function rowToResult(r: IndexRow, query: string): SearchResult {
  const result: SearchResult = {
    path: r.notePath,
    title: r.title,
    snippet: query.trim()
      ? createSnippet(r.content, query)
      : r.content.substring(0, 150).trim() + (r.content.length > 150 ? "..." : ""),
    tags: parseTags(r.tags),
    modifiedAt: r.modifiedAt,
  };
  if (typeof r.rank === "number") result.score = r.rank;
  return result;
}

/**
 * Search notes via Postgres FTS (websearch_to_tsquery against the generated
 * `tsv` GIN index). Shared notes are matched the same way against the
 * sharer's index rows. JS snippet generation is preserved so test
 * expectations for the snippet format stay stable.
 */
export async function search(
  app: FastifyInstance,
  query: string,
  userId: string,
  limit = 100,
): Promise<SearchResult[]> {
  const trimmed = query.trim();

  // Own notes
  let ownMapped: SearchResult[];
  if (!trimmed) {
    const rows = await app.db
      .select()
      .from(searchIndex)
      .where(eq(searchIndex.userId, userId))
      .orderBy(desc(searchIndex.modifiedAt))
      .limit(limit);
    ownMapped = rows.map((r) => rowToResult(r as IndexRow, ""));
  } else {
    const rows = (await app.db.execute(sql`
      SELECT
        "notePath",
        "userId",
        title,
        content,
        tags,
        "modifiedAt",
        ts_rank(tsv, q) AS rank
      FROM "SearchIndex", websearch_to_tsquery('english', ${trimmed}) AS q
      WHERE "userId" = ${userId} AND tsv @@ q
      ORDER BY rank DESC
      LIMIT ${limit}
    `)) as unknown as { rows: IndexRow[] };
    ownMapped = rows.rows.map((r) => rowToResult(r, trimmed));
  }

  // Shared notes
  const shares = await app.db
    .select()
    .from(noteShare)
    .where(eq(noteShare.sharedWithUserId, userId));

  let sharedResults: SearchResult[] = [];

  if (shares.length > 0) {
    const shareConditions = shares.map((s) =>
      s.isFolder
        ? and(
            eq(searchIndex.userId, s.ownerUserId),
            like(searchIndex.notePath, `${s.path}/%`),
          )
        : and(
            eq(searchIndex.userId, s.ownerUserId),
            eq(searchIndex.notePath, s.path),
          ),
    );

    const baseWhere = or(...shareConditions);

    let rows: IndexRow[];
    if (trimmed) {
      // Filter the shared set by FTS too.
      const candidates = await app.db
        .select({
          notePath: searchIndex.notePath,
          userId: searchIndex.userId,
          title: searchIndex.title,
          content: searchIndex.content,
          tags: searchIndex.tags,
          modifiedAt: searchIndex.modifiedAt,
        })
        .from(searchIndex)
        .where(baseWhere);

      if (candidates.length === 0) {
        rows = [];
      } else {
        // Run FTS over the candidate set in one query.
        const result = (await app.db.execute(sql`
          SELECT
            "notePath",
            "userId",
            title,
            content,
            tags,
            "modifiedAt",
            ts_rank(tsv, q) AS rank
          FROM "SearchIndex", websearch_to_tsquery('english', ${trimmed}) AS q
          WHERE tsv @@ q
            AND ("notePath", "userId") IN (
              ${sql.join(
                candidates.map(
                  (c) => sql`(${c.notePath}, ${c.userId})`,
                ),
                sql`, `,
              )}
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `)) as unknown as { rows: IndexRow[] };
        rows = result.rows;
      }
    } else {
      const candidates = await app.db
        .select({
          notePath: searchIndex.notePath,
          userId: searchIndex.userId,
          title: searchIndex.title,
          content: searchIndex.content,
          tags: searchIndex.tags,
          modifiedAt: searchIndex.modifiedAt,
        })
        .from(searchIndex)
        .where(baseWhere);
      rows = candidates as IndexRow[];
    }

    sharedResults = rows.map((r) => ({
      ...rowToResult(r, trimmed),
      isShared: true,
      ownerUserId: r.userId,
    }));
  }

  const seenPaths = new Set(ownMapped.map((r) => r.path));
  const combined = [...ownMapped];
  for (const shared of sharedResults) {
    const key = `${shared.ownerUserId}:${shared.path}`;
    if (!seenPaths.has(shared.path) && !seenPaths.has(key)) {
      seenPaths.add(key);
      combined.push(shared);
    }
  }

  return combined;
}

export async function getAllTags(
  app: FastifyInstance,
  userId: string,
): Promise<{ tag: string; count: number }[]> {
  const rows = await app.db
    .select({
      notePath: searchIndex.notePath,
      title: searchIndex.title,
      tags: searchIndex.tags,
    })
    .from(searchIndex)
    .where(eq(searchIndex.userId, userId));

  const tagCounts = new Map<string, number>();
  for (const note of rows) {
    for (const tag of parseTags(note.tags)) {
      if (tag) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getNotesByTag(
  app: FastifyInstance,
  tag: string,
  userId: string,
): Promise<{ notePath: string; title: string }[]> {
  const candidates = await app.db
    .select({
      notePath: searchIndex.notePath,
      title: searchIndex.title,
      tags: searchIndex.tags,
    })
    .from(searchIndex)
    .where(
      and(eq(searchIndex.userId, userId), like(searchIndex.tags, `%${tag}%`)),
    );

  return candidates
    .filter((note) => parseTags(note.tags).includes(tag))
    .map((note) => ({ notePath: note.notePath, title: note.title }));
}
