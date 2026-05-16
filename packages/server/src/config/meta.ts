/**
 * Per-field deployment metadata for env-var schema fields.
 *
 * Zod v4 has no stable cross-version metadata API (`.describe()` only stores
 * a string; the v4 registry feature isn't available in all release lines we
 * pin against). To avoid coupling to internals we attach metadata side-band:
 * a `WeakMap` keyed by the Zod schema instance.
 *
 * Used by `scripts/dump-config-schema.ts` to emit
 * `packages/server/config-schema.json` for deployment surfaces
 * (docker-compose, helm chart, operator CRD) per the
 * deployment-surfaces design.
 */
import type { ZodType } from "zod";

export interface FieldMeta {
  /**
   * If true, the value is sensitive — sourced from a K8s Secret / required
   * compose env block (`${VAR:?}` with no default).
   */
  secret: boolean;
  /**
   * If true, the field is exposed in helm `values.yaml` top-level for the
   * end-user to tune. If false, it's an internal knob with a chart default.
   */
  userFacing: boolean;
  /**
   * Human-readable description used as a `# comment` in compose / helm
   * values output, and as the description field in `config-schema.json`.
   */
  description?: string;
}

const registry = new WeakMap<object, FieldMeta>();

/**
 * Attach deployment metadata to a Zod schema. Returns the same schema so it
 * can be used inline inside `z.object({...})`.
 */
export function withMeta<T extends ZodType>(schema: T, meta: FieldMeta): T {
  registry.set(schema as unknown as object, meta);
  return schema;
}

/**
 * Look up deployment metadata for a schema. Returns `undefined` when none
 * was attached (the dumper treats this as a hard error — every field must
 * be annotated).
 */
export function getMeta(schema: ZodType): FieldMeta | undefined {
  return registry.get(schema as unknown as object);
}
