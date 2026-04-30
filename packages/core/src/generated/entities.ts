export interface EntityMetadata {
  name: string;
  table: string;
  tier: "tier1" | "tier2";
  parent: string | null;
}

export const ENTITIES = [
,
] as const satisfies readonly EntityMetadata[];
