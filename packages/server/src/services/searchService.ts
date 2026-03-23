import { AppDataSource } from "../data-source";
import { SearchIndex } from "../entities/SearchIndex";

/**
 * Strip markdown formatting to produce plain text for indexing.
 */
function stripMarkdown(content: string): string {
  return (
    content
      // Remove headings markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
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
 * Extract the title from markdown content. Uses the first # heading, or
 * falls back to the filename.
 */
export function extractTitle(content: string, filePath: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  // Fallback: derive from filename
  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.md$/, "");
}

/**
 * Index a note in the search database.
 */
export async function indexNote(
  notePath: string,
  content: string
): Promise<void> {
  const repo = AppDataSource.getRepository(SearchIndex);
  const title = extractTitle(content, notePath);
  const plainContent = stripMarkdown(content);
  const tags = extractTags(content);

  const entry = new SearchIndex();
  entry.notePath = notePath;
  entry.title = title;
  entry.content = plainContent;
  entry.tags = tags;
  entry.modifiedAt = new Date();

  await repo.save(entry);
}

/**
 * Remove a note from the search index.
 */
export async function removeFromIndex(notePath: string): Promise<void> {
  const repo = AppDataSource.getRepository(SearchIndex);
  await repo.delete({ notePath });
}

/**
 * Rename a note in the search index.
 */
export async function renameInIndex(
  oldPath: string,
  newPath: string
): Promise<void> {
  const repo = AppDataSource.getRepository(SearchIndex);
  const entry = await repo.findOneBy({ notePath: oldPath });
  if (entry) {
    await repo.delete({ notePath: oldPath });
    entry.notePath = newPath;
    await repo.save(entry);
  }
}

export interface SearchResult {
  notePath: string;
  title: string;
  snippet: string;
  tags: string[];
  modifiedAt: Date;
}

/**
 * Search notes by query, matching against title and content using ILIKE.
 */
export async function search(query: string): Promise<SearchResult[]> {
  const repo = AppDataSource.getRepository(SearchIndex);
  const pattern = `%${query}%`;

  const results = await repo
    .createQueryBuilder("s")
    .where("s.title ILIKE :pattern", { pattern })
    .orWhere("s.content ILIKE :pattern", { pattern })
    .orderBy("s.modifiedAt", "DESC")
    .getMany();

  return results.map((r) => {
    const snippet = createSnippet(r.content, query);
    return {
      notePath: r.notePath,
      title: r.title,
      snippet,
      tags: r.tags,
      modifiedAt: r.modifiedAt,
    };
  });
}

/**
 * Create a context snippet around the first occurrence of the query in the content.
 */
function createSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);

  if (idx === -1) {
    // Query matched title only; return beginning of content
    return content.substring(0, 150).trim() + (content.length > 150 ? "..." : "");
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + query.length + 60);
  let snippet = content.substring(start, end).trim();

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}
