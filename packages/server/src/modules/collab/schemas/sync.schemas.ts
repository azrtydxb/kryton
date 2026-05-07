import { z } from "zod";

export const syncPullBodySchema = z.object({
  cursor: z.string().default("0"),
});

const entityOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    id: z.string(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("update"),
    id: z.string(),
    base_version: z.number().int(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("delete"),
    id: z.string(),
  }),
]);

export const syncPushBodySchema = z.object({
  changes: z.record(z.string(), z.array(entityOpSchema)),
});

export const tier2ParamsSchema = z.object({
  entityType: z.string().min(1),
  parentId: z.string().min(1),
});

export const tier2QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Responses are intentionally loose (server-generated, mixed types).
const tableChangesSchema = z.object({
  created: z.array(z.unknown()),
  updated: z.array(z.unknown()),
  deleted: z.array(z.string()),
});

export const syncPullResponseSchema = z.object({
  cursor: z.string(),
  changes: z.record(z.string(), tableChangesSchema),
});

export const syncPushResponseSchema = z.object({
  accepted: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        version: z.number().int(),
        merged_value: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  ),
  conflicts: z.array(
    z.object({
      table: z.string(),
      id: z.string(),
      current_version: z.number().int(),
      current_state: z.unknown(),
    }),
  ),
});

export const tier2ResponseSchema = z.object({
  entities: z.array(z.unknown()),
});
