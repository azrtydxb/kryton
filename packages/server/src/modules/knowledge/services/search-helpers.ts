/**
 * Pure helpers for search/index processing — frontmatter, markdown,
 * tags, snippet generation. No Fastify or Prisma dependencies.
 */

export interface ParsedFrontmatter {
  frontmatter: Record<string, string> | null;
  body: string;
}

/** Parse tags from DB string (JSON array) to string[] */
export function parseTags(tags: string): string[] {
  if (!tags) return [];
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

/** Serialize string[] tags to DB string */
export function serializeTags(tags: string[]): string {
  return JSON.stringify(tags);
}

/**
 * Parse YAML-style frontmatter (key: value pairs) from a markdown string.
 * Returns the parsed fields and the body with frontmatter stripped.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
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

/**
 * Strip markdown formatting to produce plain text for indexing.
 */
export function stripMarkdown(content: string): string {
  return (
    content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      .replace(/_{1,3}(.*?)_{1,3}/g, "$1")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^[-*_]{3,}\s*$/gm, "")
      .replace(/- \[[ x]\] /g, "- ")
  );
}

/**
 * Extract tags (words starting with #) from content.
 */
export function extractTags(content: string): string[] {
  const tagRegex = /#([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
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
  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.md$/, "");
}

/**
 * Create a context snippet around the first occurrence of the query in the content.
 */
export function createSnippet(content: string, query: string): string {
  if (!query.trim()) {
    return content.substring(0, 150).trim() + (content.length > 150 ? "..." : "");
  }

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);

  if (idx === -1) {
    return content.substring(0, 150).trim() + (content.length > 150 ? "..." : "");
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + query.length + 60);
  let snippet = content.substring(start, end).trim();

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}
