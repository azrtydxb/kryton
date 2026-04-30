// packages/core/scripts/lib/field-parser.ts
export interface FieldDef {
  name: string;
  prismaType: string;
  optional: boolean;
  isArray: boolean;
  attrs: string[];
  default: string | undefined;
  isId: boolean;
}

const RELATION_RE = /@relation\(/;
const SCALAR_TYPES = new Set([
  "String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "Decimal", "BigInt",
]);

export function parseField(line: string): FieldDef | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) return null;
  if (RELATION_RE.test(trimmed)) return null;

  const m = trimmed.match(/^(\w+)\s+(\w+)(\??)(\[\])?(.*)$/);
  if (!m) return null;
  const [, name, prismaType, optMark, arrMark, rest] = m;
  if (!SCALAR_TYPES.has(prismaType)) return null;

  const attrs = rest.match(/@\w+(\([^)]*\))?/g) ?? [];
  const defMatch = rest.match(/@default\(([^)]+)\)/);
  return {
    name,
    prismaType,
    optional: optMark === "?",
    isArray: arrMark === "[]",
    attrs,
    default: defMatch ? defMatch[1] : undefined,
    isId: attrs.some(a => a.startsWith("@id")),
  };
}
