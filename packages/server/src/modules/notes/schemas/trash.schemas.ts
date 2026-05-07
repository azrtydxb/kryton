import { z } from "zod";

export const trashItemSchema = z.object({
  path: z.string(),
  originalPath: z.string(),
  trashedAt: z.union([z.string(), z.date()]),
});

export const trashListResponseSchema = z.array(trashItemSchema);

export const trashRestoreResponseSchema = z.object({
  message: z.string(),
  path: z.string(),
});

export const trashDeleteResponseSchema = z.object({
  message: z.string(),
});

export const trashEmptyResponseSchema = z.object({
  message: z.string(),
});

export const trashWildcardParamsSchema = z.object({
  "*": z.string(),
});
