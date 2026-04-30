// packages/core/scripts/lib/sql-emitter.ts
import type { FieldDef } from "./field-parser";

export interface ModelDef {
  name: string;
  tier: "tier1" | "tier2";
  parent: string | null;
  fields: FieldDef[];
}

const TYPE_MAP: Record<string, string> = {
  String: "TEXT",
  Int: "INTEGER",
  Float: "REAL",
  Boolean: "INTEGER",
  DateTime: "INTEGER",
  Json: "TEXT",
  Bytes: "BLOB",
  Decimal: "REAL",
  BigInt: "INTEGER",
};

function fieldDDL(f: FieldDef): string {
  const sqlType = f.isArray ? "TEXT" : TYPE_MAP[f.prismaType] ?? "TEXT";
  const nullness = f.optional ? "" : " NOT NULL";
  const id = f.isId ? " PRIMARY KEY" : "";
  return `  ${f.name} ${sqlType}${nullness}${id}`;
}

export function emitTableDDL(model: ModelDef): string {
  const tableName = snakeCase(model.name);
  const fieldLines = model.fields.map(fieldDDL).join(",\n");
  const meta =
    `  _local_status TEXT NOT NULL DEFAULT 'synced',\n` +
    `  _local_seq INTEGER NOT NULL DEFAULT 0,\n` +
    `  version INTEGER NOT NULL DEFAULT 0`;
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${fieldLines},\n${meta}\n);`;
}

export function snakeCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
