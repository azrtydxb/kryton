// packages/core/scripts/generate-schema.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to monorepo root regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONOREPO_ROOT = resolve(__dirname, "../../..");
import { walkPrismaSchema } from "./lib/prisma-walker.js";
import { parseAnnotations } from "./lib/annotation-parser.js";
import { parseField } from "./lib/field-parser.js";
import { emitTableDDL, type ModelDef } from "./lib/sql-emitter.js";
import { emitInterface } from "./lib/ts-emitter.js";
import { emitEntityMetadata } from "./lib/entities-emitter.js";

export interface GeneratedOutput {
  sql: string;
  types: string;
  entities: string;
}

const CORE_INTERNAL_SQL = `
-- Core internal bookkeeping
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS yjs_documents (
  doc_id TEXT PRIMARY KEY,
  snapshot BLOB NOT NULL,
  state_vector BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS yjs_pending_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  update_data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tier2_cache_meta (
  entity_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, parent_id)
);
`;

export function generateFromString(prismaSource: string): GeneratedOutput {
  const rawModels = walkPrismaSchema(prismaSource);
  const annotated: ModelDef[] = [];
  for (const m of rawModels) {
    const ann = parseAnnotations(m.annotationBlock);
    if (!ann) continue;
    const fields = m.fields.map(parseField).filter((f): f is NonNullable<typeof f> => f !== null);
    annotated.push({ name: m.name, tier: ann.tier, parent: ann.parent, fields });
  }
  const sqlBlocks = annotated.map(emitTableDDL);
  const tsBlocks = annotated.map(emitInterface);
  return {
    sql: sqlBlocks.join("\n\n") + "\n" + CORE_INTERNAL_SQL,
    types: tsBlocks.join("\n\n") + "\n",
    entities: emitEntityMetadata(annotated) + "\n",
  };
}

export function generate(): void {
  const prismaPath = resolve(MONOREPO_ROOT, "packages/server/prisma/schema.prisma");
  const outDir = resolve(MONOREPO_ROOT, "packages/core/src/generated");
  const source = readFileSync(prismaPath, "utf8");
  const out = generateFromString(source);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "schema.sql"), out.sql, "utf8");
  writeFileSync(resolve(outDir, "types.ts"), out.types, "utf8");
  writeFileSync(resolve(outDir, "entities.ts"), out.entities, "utf8");
  console.log(`Generated ${outDir}/{schema.sql,types.ts,entities.ts}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generate();
}
