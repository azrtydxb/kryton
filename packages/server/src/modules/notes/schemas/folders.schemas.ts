import { z } from "zod";

export const createFolderBodySchema = z.object({
  // Accept either path or name (preserves Express behaviour)
  path: z.string().min(1).max(500).optional(),
  name: z.string().min(1).max(200).optional(),
}).refine((v) => Boolean(v.path || v.name), {
  message: "Either path or name is required",
});

export const renameFolderBodySchema = z.object({
  newPath: z.string().min(1).max(500),
});

export const folderCreatedResponseSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const folderDeletedResponseSchema = z.object({
  message: z.string(),
});

export const folderRenamedResponseSchema = z.object({
  oldPath: z.string(),
  newPath: z.string(),
  message: z.string(),
});
