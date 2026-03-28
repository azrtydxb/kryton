import MiniSearch from "minisearch";
import { prisma } from "../prisma.js";

// Local shape matching the Prisma SearchIndex model (avoids relying on generated types)
interface SearchIndexRow {
  notePath: string;
  userId: string;
  title: string;
  content: string;
  tags: string; // JSON array string, e.g. '["tag1","tag2"]'
  modifiedAt: Date;
}

/** Parse tags from DB string (JSON array) to string[] */
function parseTags(tags: string): string[] {
  if (!tags) return [];
  try { return JSON.parse(tags); } catch { return []; }
}

/** Serialize string[] tags to DB string */
function serializeTags(tags: string[]): string {
  return JSON.stringify(tags);
}

// ---------------------------------------------------------------------------
// MiniSearch in-memory index — one instance per user
// ---------------------------------------------------------------------------

interface IndexedDocument {
  id: string; // notePath (unique within a user's index)
  title: string;
  content: string;
  tags: string;
  notePath: string;
}

// LRU cache for per-user MiniSearch indices — evicts least-recently-used when full
const MAX_CACHED_INDICES = 50;
const userIndices = new Map<string, MiniSearch<IndexedDocument>>();
// Track which users have had their index fully built from Prisma
const builtIndices = new Set<string>();
// LRU order — most recently accessed at the end
const lruOrder: string[] = [];

function touchLru(userId: string): void {
  const idx = lruOrder.indexOf(userId);
  if (idx !== -1) lruOrder.splice(idx, 1);
  lruOrder.push(userId);

  // Evict oldest entries if over limit
  while (lruOrder.length > MAX_CACHED_INDICES) {
    const evictId = lruOrder.shift()!;
    userIndices.delete(evictId);
    builtIndices.delete(evictId);
  }
}

function getOrCreateIndex(userId: string): MiniSearch<IndexedDocument> {
  let index = userIndices.get(userId);
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
    userIndices.set(userId, index);
  }
  touchLru(userId);
  return index;
}

/**
 * Load all SearchIndex rows from Prisma for a user and populate the
 * MiniSearch index. Safe to call multiple times — skips users already built.
 */
async function buildIndex(userId: string): Promise<void> {
  if (builtIndices.has(userId)) return;

  const index = getOrCreateIndex(userId);
  const rows = await prisma.searchIndex.findMany({ where: { userId } });

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

  builtIndices.add(userId);
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

interface ParsedFrontmatter {
  frontmatter: Record<string, string> | null;
  body: string;
}

/**
 * Parse YAML-style frontmatter (key: value pairs) from a markdown string.
 * Returns the parsed fields and the body with frontmatter stripped.
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---")) {
    return { frontmatter: null, body: content };
  }

  const afterOpen = content.indexOf("\n", 3);
  if (afterOpen === -1) return { frontmatter: null, body: content };

  const closeIndex = content.indexOf("\n---", afterOpen);
  if (closeIndex === -1) return { frontmatter: null, body: content };

  const yamlBlock = content.slice(afterOpen + 1, closeIndex);
  const body = content.slice(closeIndex + 4).replace(/^\n/, "");

  const result: Record<string, string> = {};
  const lines = yamlBlock.split("\n");
  let currentKey: string | null = null;
  const listAccumulator: string[] = [];

  function flushList() {
    if (currentKey !== null && listAccumulator.length > 0) {
      result[currentKey] = listAccumulator.join(", ");
      listAccumulator.length = 0;
    }
  }

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (/^\s+-\s+/.test(line)) {
      listAccumulator.push(line.replace(/^\s+-\s+/, "").trim());
      continue;
    }

    const kvMatch = line.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      flushList();
      currentKey = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        result[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ");
        currentKey = null;
      } else if (val !== "") {
        result[currentKey] = val.replace(/^['"]|['"]$/g, "");
        currentKey = null;
      }
    }
  }

  flushList();

  if (Object.keys(result).length === 0) {
    return { frontmatter: null, body: content };
  }

  return { frontmatter: result, body };
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown formatting to produce plain text for indexing.
 */
function stripMarkdown(content: string): string {
  return (
    content
      // Remove headings markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers (lazy quantifiers to avoid ReDoS)
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      .replace(/_{1,3}(.*?)_{1,3}/g, "$1")
      // Remove wiki links but keep text
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      // Remove markdown links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove checkbox markers
      .replace(/- \[[ x]\] /g, "- ")
  );
}

/**
 * Extract tags (words starting with #) from content.
 */
function extractTags(content: string): string[] {
  const tagRegex = /#([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    // Avoid matching headings — tags must not be preceded by a newline + #
    // The regex only matches #word patterns; headings are "# Word" (with space)
    tags.push(match[1]);
  }
  return [...new Set(tags)];
}

/**
 * Extract the title from markdown content. Checks frontmatter `title` field
 * first, then the first # heading, then falls back to the filename.
 */
export function extractTitle(content: string, filePath: string): string {
  const { frontmatter } = parseFrontmatter(content);
  if (frontmatter?.title) {
    return frontmatter.title;
  }
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  // Fallback: derive from filename
  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Index a note in the search database and the in-memory MiniSearch index.
 */
export async function indexNote(
  notePath: string,
  content: string,
  userId: string
): Promise<void> {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = extractTitle(content, notePath);

  // Strip markdown from the body (frontmatter stripped) so YAML syntax isn't indexed
  const plainContent = [
    stripMarkdown(body),
    // Append all frontmatter values so they are searchable
    ...(frontmatter ? Object.values(frontmatter) : []),
  ]
    .filter(Boolean)
    .join(" ");

  // Combine inline #tags with any comma-separated tags from frontmatter
  const inlineTags = extractTags(body);
  const frontmatterTags: string[] =
    frontmatter?.tags
      ? frontmatter.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const tags = [...new Set([...inlineTags, ...frontmatterTags])];

  // Persist to Prisma
  await prisma.searchIndex.upsert({
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

  // Update in-memory index only if this user's index has already been built;
  // otherwise the document will be loaded from Prisma on the next buildIndex call.
  if (builtIndices.has(userId)) {
    const index = getOrCreateIndex(userId);
    const doc: IndexedDocument = {
      id: notePath,
      title,
      content: plainContent,
      tags: tags.join(" "),
      notePath,
    };
    // MiniSearch has no upsert — remove first if it exists, then add
    if (index.has(notePath)) {
      index.remove({ id: notePath } as IndexedDocument);
    }
    index.add(doc);
  }
}

/**
 * Remove a note from the search index (Prisma + in-memory).
 */
export async function removeFromIndex(notePath: string, userId: string): Promise<void> {
  await prisma.searchIndex.deleteMany({ where: { notePath, userId } });

  if (builtIndices.has(userId)) {
    const index = userIndices.get(userId);
    if (index?.has(notePath)) {
      index.remove({ id: notePath } as IndexedDocument);
    }
  }
}

/**
 * Rename a note in the search index (Prisma + in-memory).
 */
export async function renameInIndex(
  oldPath: string,
  newPath: string,
  userId: string
): Promise<void> {
  const entry = await prisma.searchIndex.findUnique({
    where: { notePath_userId: { notePath: oldPath, userId } },
  });
  if (entry) {
    await prisma.searchIndex.delete({
      where: { notePath_userId: { notePath: oldPath, userId } },
    });
    await prisma.searchIndex.create({
      data: {
        notePath: newPath,
        userId,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        modifiedAt: entry.modifiedAt,
      },
    });

    if (builtIndices.has(userId)) {
      const index = userIndices.get(userId);
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

/**
 * Get all tags across all notes with their counts.
 */
export async function getAllTags(userId: string): Promise<{ tag: string; count: number }[]> {
  const allNotes = await prisma.searchIndex.findMany({
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

/**
 * Get all note paths that have a given tag.
 */
export async function getNotesByTag(
  tag: string,
  userId: string
): Promise<{ notePath: string; title: string }[]> {
  const candidates = await prisma.searchIndex.findMany({
    where: { userId, tags: { contains: tag } },
    select: { notePath: true, title: true, tags: true },
  });

  return candidates
    .filter((note) => parseTags(note.tags).includes(tag))
    .map((note) => ({ notePath: note.notePath, title: note.title }));
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
 * and Prisma ILIKE for shared notes (which belong to other users' indices that may
 * not be loaded into memory).
 */
export async function search(query: string, userId: string): Promise<SearchResult[]> {
  // 1. Build the in-memory index for this user if not yet done
  await buildIndex(userId);

  // 2. Own notes — use MiniSearch
  const index = getOrCreateIndex(userId);
  let ownMapped: SearchResult[];

  if (!query.trim()) {
    // Empty query: return all own notes ordered by modifiedAt (from Prisma)
    const allOwn = await prisma.searchIndex.findMany({
      where: { userId },
      orderBy: { modifiedAt: "desc" },
    });
    ownMapped = (allOwn as SearchIndexRow[]).map((r) => ({
      path: r.notePath,
      title: r.title,
      snippet: r.content.substring(0, 150).trim() + (r.content.length > 150 ? "..." : ""),
      tags: parseTags(r.tags),
      modifiedAt: r.modifiedAt,
    }));
  } else {
    const miniResults = index.search(query);

    // Fetch full records from Prisma to get modifiedAt and full content for snippets
    const notePaths = miniResults.map((r) => r.id as string);
    const prismaRows = notePaths.length > 0
      ? await prisma.searchIndex.findMany({
          where: { userId, notePath: { in: notePaths } },
        })
      : [];

    const rowByPath = new Map((prismaRows as SearchIndexRow[]).map((r) => [r.notePath, r]));

    // Preserve MiniSearch relevance order
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

  // 3. Shared notes — single batched query instead of N per-share queries
  const shares = await prisma.noteShare.findMany({
    where: { sharedWithUserId: userId },
  });

  let sharedResults: SearchResult[] = [];

  if (shares.length > 0) {
    const shareConditions = shares.map((s) =>
      s.isFolder
        ? { userId: s.ownerUserId, notePath: { startsWith: s.path + "/" } }
        : { userId: s.ownerUserId, notePath: s.path }
    );

    const queryFilter = query.trim()
      ? {
          OR: [
            { title: { contains: query } },
            { content: { contains: query } },
          ],
        }
      : {};

    const matchingNotes = await prisma.searchIndex.findMany({
      where: {
        AND: [
          { OR: shareConditions },
          queryFilter,
        ],
      },
      select: { notePath: true, title: true, content: true, tags: true, modifiedAt: true, userId: true },
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

  // 4. Combine and deduplicate by path (own notes take priority)
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

/**
 * Create a context snippet around the first occurrence of the query in the content.
 */
function createSnippet(content: string, query: string): string {
  if (!query.trim()) {
    return content.substring(0, 150).trim() + (content.length > 150 ? "..." : "");
  }

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);

  if (idx === -1) {
    // Query matched title only or via fuzzy; return beginning of content
    return content.substring(0, 150).trim() + (content.length > 150 ? "..." : "");
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + query.length + 60);
  let snippet = content.substring(start, end).trim();

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}
