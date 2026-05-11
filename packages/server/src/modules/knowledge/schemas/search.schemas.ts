import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().min(1, "Query parameter 'q' is required"),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const searchResultSchema = z.object({
  path: z.string(),
  title: z.string(),
  snippet: z.string(),
  tags: z.array(z.string()),
  modifiedAt: z.coerce.date(),
  isShared: z.boolean().optional(),
  ownerUserId: z.string().optional(),
  score: z.number().optional(),
  chunkIndex: z.number().int().optional(),
});

export const searchResponseSchema = z.array(searchResultSchema);

export const semanticReadyResponseSchema = z.object({
  ready: z.boolean(),
  provider: z.enum(["pgvector-local", "novamem", "off"]),
  model: z.string().optional(),
  dimensions: z.number().int(),
  pendingJobs: z.number().int(),
});

export const semanticReindexQuerySchema = z.object({
  scope: z.enum(["self", "all"]).optional().default("self"),
});

export const semanticReindexResponseSchema = z.object({
  enqueued: z.number().int(),
});

export const fusionWeightsSchema = z.object({
  lex: z.number().min(0).max(1),
  sem: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
});
