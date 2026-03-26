export interface Frontmatter {
  [key: string]: string;
}

export interface ParsedFrontmatter {
  frontmatter: Frontmatter | null;
  body: string;
}

/**
 * Parse YAML-style frontmatter from the beginning of a markdown string.
 * Supports `key: value` pairs and simple lists (`- item`) which are joined
 * with ", ". If the content does not start with `---`, returns null frontmatter
 * and the original content as body.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  // Must start with --- (optionally preceded by a BOM / whitespace on the same line)
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }

  // Find the closing ---
  const afterOpen = content.indexOf('\n', 3);
  if (afterOpen === -1) {
    return { frontmatter: null, body: content };
  }

  const closeIndex = content.indexOf('\n---', afterOpen);
  if (closeIndex === -1) {
    return { frontmatter: null, body: content };
  }

  const yamlBlock = content.slice(afterOpen + 1, closeIndex);
  const body = content.slice(closeIndex + 4).replace(/^\n/, '');

  const frontmatter: Frontmatter = {};
  const lines = yamlBlock.split('\n');
  let currentKey: string | null = null;
  const listAccumulator: string[] = [];

  function flushList() {
    if (currentKey !== null && listAccumulator.length > 0) {
      frontmatter[currentKey] = listAccumulator.join(', ');
      listAccumulator.length = 0;
    }
  }

  for (const line of lines) {
    // Skip blank lines
    if (line.trim() === '') continue;

    // List item under the current key
    if (/^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      listAccumulator.push(value);
      continue;
    }

    // New key: value pair — flush any pending list first
    const kvMatch = line.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      flushList();
      currentKey = kvMatch[1].trim();
      const val = kvMatch[2].trim();

      // Inline list value like `tags: [a, b, c]`
      if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ');
        currentKey = null;
      } else if (val !== '') {
        // Strip surrounding quotes
        frontmatter[currentKey] = val.replace(/^['"]|['"]$/g, '');
        currentKey = null;
      }
      // If val is empty, the value may be a list on the following lines — keep currentKey set
      continue;
    }
  }

  // Flush any trailing list
  flushList();

  if (Object.keys(frontmatter).length === 0) {
    return { frontmatter: null, body: content };
  }

  return { frontmatter, body };
}
