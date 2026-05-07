import { z } from "zod";

export const graphNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  shared: z.boolean().optional(),
  ownerUserId: z.string().optional(),
});

export const graphEdgeSchema = z.object({
  fromNoteId: z.string(),
  toNoteId: z.string(),
  fromPath: z.string().nullable(),
  toPath: z.string().nullable(),
});

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});
