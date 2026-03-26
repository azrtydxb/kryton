export interface FrontmatterResult {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const empty: FrontmatterResult = { frontmatter: {}, body: content };

  if (!content.startsWith("---")) {
    return empty;
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return empty;
  }

  const block = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");

  const frontmatter: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}
