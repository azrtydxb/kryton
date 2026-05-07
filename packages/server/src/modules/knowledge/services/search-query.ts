import type { FastifyInstance } from "fastify";
import { parseTags, createSnippet } from "./search-helpers.js";
import type { SearchIndexManager } from "./search-index.js";

interface SearchIndexRow {
  notePath: string;
  userId: string;
  title: string;
  content: string;
  tags: string;
  modifiedAt: Date;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  modifiedAt: Date;
  isShared?: boolean;
  ownerUserId?: string;
}

/**
 * Search notes using MiniSearch for own notes (fuzzy + prefix + relevance scoring),
 * and Prisma `contains` for shared notes (which belong to other users' indices that
 * may not be loaded into memory).
 */
export async function search(
  app: FastifyInstance,
  index: SearchIndexManager,
  query: string,
  userId: string,
): Promise<SearchResult[]> {
  await index.buildIndex(userId);

  const mini = index.getOrCreateIndex(userId);
  let ownMapped: SearchResult[];

  if (!query.trim()) {
    const allOwn = await app.prisma.searchIndex.findMany({
      where: { userId },
      orderBy: { modifiedAt: "desc" },
    });
    ownMapped = (allOwn as SearchIndexRow[]).map((r) => ({
      path: r.notePath,
      title: r.title,
      snippet:
        r.content.substring(0, 150).trim() + (r.content.length > 150 ? "..." : ""),
      tags: parseTags(r.tags),
      modifiedAt: r.modifiedAt,
    }));
  } else {
    const miniResults = mini.search(query);
    const notePaths = miniResults.map((r) => r.id as string);
    const prismaRows =
      notePaths.length > 0
        ? await app.prisma.searchIndex.findMany({
            where: { userId, notePath: { in: notePaths } },
          })
        : [];

    const rowByPath = new Map(
      (prismaRows as SearchIndexRow[]).map((r) => [r.notePath, r]),
    );

    ownMapped = miniResults
      .map((r) => {
        const row = rowByPath.get(r.id as string);
        if (!row) return null;
        return {
          path: row.notePath,
          title: row.title,
          snippet: createSnippet(row.content, query),
          tags: parseTags(row.tags),
          modifiedAt: row.modifiedAt,
        };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  // Shared notes
  const shares = await app.prisma.noteShare.findMany({
    where: { sharedWithUserId: userId },
  });

  let sharedResults: SearchResult[] = [];

  if (shares.length > 0) {
    const shareConditions = shares.map((s) =>
      s.isFolder
        ? { userId: s.ownerUserId, notePath: { startsWith: s.path + "/" } }
        : { userId: s.ownerUserId, notePath: s.path },
    );

    const queryFilter = query.trim()
      ? {
          OR: [
            { title: { contains: query } },
            { content: { contains: query } },
          ],
        }
      : {};

    const matchingNotes = await app.prisma.searchIndex.findMany({
      where: {
        AND: [{ OR: shareConditions }, queryFilter],
      },
      select: {
        notePath: true,
        title: true,
        content: true,
        tags: true,
        modifiedAt: true,
        userId: true,
      },
    });

    sharedResults = matchingNotes.map((r) => ({
      path: r.notePath,
      title: r.title,
      snippet: createSnippet(r.content, query),
      tags: parseTags(r.tags),
      modifiedAt: r.modifiedAt,
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
  const allNotes = await app.prisma.searchIndex.findMany({
    where: { userId },
    select: { notePath: true, title: true, tags: true },
  });

  const tagCounts = new Map<string, number>();
  for (const note of allNotes) {
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
  const candidates = await app.prisma.searchIndex.findMany({
    where: { userId, tags: { contains: tag } },
    select: { notePath: true, title: true, tags: true },
  });

  return candidates
    .filter((note) => parseTags(note.tags).includes(tag))
    .map((note) => ({ notePath: note.notePath, title: note.title }));
}
