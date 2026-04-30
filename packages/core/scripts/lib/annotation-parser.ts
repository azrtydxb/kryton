// packages/core/scripts/lib/annotation-parser.ts
export interface SyncAnnotation {
  tier: "tier1" | "tier2";
  parent: string | null;
  excludeFields: string[];
}

export function parseAnnotations(block: string): SyncAnnotation | null {
  const lines = block.split("\n").map(l => l.trim());
  let tier: "tier1" | "tier2" | null = null;
  let parent: string | null = null;
  const excludeFields: string[] = [];

  for (const line of lines) {
    const tierMatch = line.match(/^\/\/\/\s*@sync\s+(tier1|tier2)(?:\s+parent=(\w+))?/);
    if (tierMatch) {
      tier = tierMatch[1] as "tier1" | "tier2";
      parent = tierMatch[2] ?? null;
      continue;
    }
    const fieldsMatch = line.match(/^\/\/\/\s*@sync\.fields\s+exclude=([\w,]+)/);
    if (fieldsMatch) {
      excludeFields.push(...fieldsMatch[1].split(","));
    }
  }

  if (tier === null) return null;
  return { tier, parent, excludeFields };
}
