import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().min(1, "Query parameter 'q' is required"),
});

export const searchResultSchema = z.object({
  path: z.string(),
  title: z.string(),
  snippet: z.string(),
  tags: z.array(z.string()),
  modifiedAt: z.coerce.date(),
  isShared: z.boolean().optional(),
  ownerUserId: z.string().optional(),
});

export const searchResponseSchema = z.array(searchResultSchema);
