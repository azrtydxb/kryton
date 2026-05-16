/**
 * Walk a Zod schema declared in `env.ts` and extract the deployment-relevant
 * shape of each field: name, type, required, default, and (for enums) the
 * allowed values. Combined with the metadata side-band from `meta.ts`, this
 * is what `scripts/dump-config-schema.ts` emits to `config-schema.json`.
 *
 * We intentionally do NOT use Zod's `_def.type` directly outside this module
 * — the field schemas can be wrapped in `default()`, `optional()`,
 * `transform()` or `coerce()`, all of which appear as a wrapper type
 * (`default`, `optional`, `pipe`) in the def. This module unwraps them.
 *
 * Type mapping (per the deployment-surfaces spec):
 *   ZodString          → "string"
 *   ZodNumber          → "number"
 *   ZodBoolean         → "boolean"
 *   ZodEnum            → "enum"  (+ `values`)
 *
 * Anything else throws — we want a hard error if a new Zod type is added to
 * `env.ts` without a deliberate decision about how it maps to compose / helm
 * surfaces.
 */
import type { ZodObject, ZodType } from "zod";
import { getMeta, type FieldMeta } from "./meta.js";

export type FieldType = "string" | "number" | "boolean" | "enum";

export interface FieldDescriptor {
  name: string;
  type: FieldType;
  /** Present when `type === "enum"`. Stable order, matches the Zod declaration. */
  values?: string[];
  required: boolean;
  secret: boolean;
  userFacing: boolean;
  /** The literal default value, when one was declared via `.default()`. */
  default?: unknown;
  description?: string;
}

export interface SchemaDescriptor {
  fields: FieldDescriptor[];
}

interface UnwrappedField {
  /** The innermost Zod schema (e.g. a `ZodString` / `ZodEnum`). */
  base: ZodType;
  /** True if any wrapping layer was `.optional()`. */
  optional: boolean;
  /** True if any wrapping layer was `.default(...)`. */
  hasDefault: boolean;
  defaultValue?: unknown;
}

/**
 * Peel `default`, `optional`, and `pipe` wrappers off a Zod schema.
 *
 * For `pipe` (which `.transform()` and `.refine()` produce in Zod v4) we walk
 * into `.in` — the input side of the pipe carries the type and default that
 * deployment surfaces care about. The transform's output type is irrelevant
 * for env-var serialization.
 */
function unwrap(schema: ZodType): UnwrappedField {
  let cur: ZodType = schema;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;

  // Defensive bound — env fields realistically wrap 2–3 layers deep.
  for (let i = 0; i < 16; i++) {
    const def = (cur as unknown as { _def?: { type?: string } })._def;
    if (!def) break;
    const t = def.type;
    if (t === "default") {
      const d = def as unknown as { defaultValue: unknown; innerType: ZodType };
      hasDefault = true;
      defaultValue = typeof d.defaultValue === "function"
        ? (d.defaultValue as () => unknown)()
        : d.defaultValue;
      cur = d.innerType;
      continue;
    }
    if (t === "optional" || t === "nullable") {
      optional = true;
      cur = (def as unknown as { innerType: ZodType }).innerType;
      continue;
    }
    if (t === "pipe") {
      // `coerce.X()`, `.transform()`, `.refine()` all produce `pipe`.
      // The input side carries the user-supplied type / default; the output
      // side is what the runtime sees post-transform — not useful here.
      cur = (def as unknown as { in: ZodType }).in;
      continue;
    }
    break;
  }
  return { base: cur, optional, hasDefault, defaultValue };
}

function classify(base: ZodType): { type: FieldType; values?: string[] } {
  const def = (base as unknown as { _def: { type: string; entries?: Record<string, string> } })._def;
  switch (def.type) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "enum": {
      // Zod v4 stores enums as `entries: { [key]: value }`. We emit the
      // values in declaration order — `Object.values` preserves it since
      // Zod populates the entries object in the order the user passed.
      const entries = def.entries ?? {};
      return { type: "enum", values: Object.values(entries) };
    }
    default:
      throw new Error(
        `introspect: unsupported Zod type "${def.type}". Update introspect.ts ` +
          `to declare how this maps to deployment surfaces, then re-run ` +
          `\`npm run config:dump\`.`,
      );
  }
}

export function introspectField(name: string, schema: ZodType): FieldDescriptor {
  const meta: FieldMeta | undefined = getMeta(schema);
  if (!meta) {
    throw new Error(
      `introspect: env field "${name}" has no deployment metadata. Wrap it ` +
        `in \`withMeta(..., { secret, userFacing, description })\` in ` +
        `packages/server/src/config/env.ts.`,
    );
  }
  const { base, optional, hasDefault, defaultValue } = unwrap(schema);
  const { type, values } = classify(base);

  // A field is "required" (from a deployment standpoint — i.e. must be
  // provided by the operator) when the schema is neither optional nor
  // has a default. `.optional()` and `.default()` both make the runtime
  // accept missing env, so neither is required in the deployment sense.
  const required = !optional && !hasDefault;

  const out: FieldDescriptor = {
    name,
    type,
    required,
    secret: meta.secret,
    userFacing: meta.userFacing,
  };
  if (values !== undefined) out.values = values;
  if (hasDefault) out.default = defaultValue;
  if (meta.description !== undefined) out.description = meta.description;
  return out;
}

export function introspectSchema(
  obj: ZodObject<Record<string, ZodType>>,
): SchemaDescriptor {
  const shape = obj.shape;
  const fields: FieldDescriptor[] = [];
  // Preserve declaration order — `Object.keys(shape)` returns keys in
  // insertion order, which matches the source order in `env.ts`.
  for (const name of Object.keys(shape)) {
    fields.push(introspectField(name, shape[name]));
  }
  return { fields };
}

/**
 * Serialize a `FieldDescriptor` to a plain object with keys in sorted
 * (stable) order. Unset optional keys are omitted.
 */
function serializeField(field: FieldDescriptor): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: field.name,
    required: field.required,
    secret: field.secret,
    type: field.type,
    userFacing: field.userFacing,
  };
  if (field.values !== undefined) out.values = [...field.values];
  if (field.default !== undefined) out.default = field.default;
  if (field.description !== undefined) out.description = field.description;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return sorted;
}

/**
 * Serialize a Zod env schema to the canonical JSON string written to
 * `config-schema.json` — fields in declaration order, per-field keys in
 * sorted order, trailing newline (mirrors `dump-openapi.ts`).
 */
export function serializeSchema(
  obj: ZodObject<Record<string, ZodType>>,
): string {
  const descriptor = introspectSchema(obj);
  const payload = { fields: descriptor.fields.map(serializeField) };
  return JSON.stringify(payload, null, 2) + "\n";
}
