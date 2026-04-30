// packages/core/scripts/lib/ts-emitter.ts
import type { FieldDef } from "./field-parser";
import type { ModelDef } from "./sql-emitter";

const TS_TYPE_MAP: Record<string, string> = {
  String: "string",
  Int: "number",
  Float: "number",
  Boolean: "boolean",
  DateTime: "number",
  Json: "unknown",
  Bytes: "Uint8Array",
  Decimal: "number",
  BigInt: "number",
};

function fieldType(f: FieldDef): string {
  const base = TS_TYPE_MAP[f.prismaType] ?? "unknown";
  let t = f.isArray ? `${base}[]` : base;
  if (f.optional) t = `${t} | null`;
  return t;
}

export function emitInterface(model: ModelDef): string {
  const lines = [
    `export interface ${model.name} {`,
    ...model.fields.map(f => `  ${f.name}: ${fieldType(f)};`),
    `  version: number;`,
    `}`,
  ];
  return lines.join("\n");
}
