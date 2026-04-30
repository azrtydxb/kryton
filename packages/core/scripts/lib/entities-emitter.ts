// packages/core/scripts/lib/entities-emitter.ts
import { snakeCase, type ModelDef } from "./sql-emitter";

export function emitEntityMetadata(models: ModelDef[]): string {
  const entries = models.map(m => {
    const parent = m.parent ? `"${m.parent}"` : "null";
    return `  { name: "${m.name}", table: "${snakeCase(m.name)}", tier: "${m.tier}", parent: ${parent} }`;
  });
  return [
    `export interface EntityMetadata {`,
    `  name: string;`,
    `  table: string;`,
    `  tier: "tier1" | "tier2";`,
    `  parent: string | null;`,
    `}`,
    ``,
    `export const ENTITIES = [`,
    entries.join(",\n") + ",",
    `] as const satisfies readonly EntityMetadata[];`,
  ].join("\n");
}
