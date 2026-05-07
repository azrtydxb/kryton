import { z } from "zod";

// Note CRUD
export const createNoteBodySchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000).optional(),
});

export const updateNoteBodySchema = z.object({
  content: z.string().max(1_000_000),
});

export const renameNoteBodySchema = z.object({
  newPath: z.string().min(1).max(500),
});

export const wildcardPathParamsSchema = z.object({
  "*": z.string(),
});

export const sharedNotePathParamsSchema = z.object({
  ownerUserId: z.string().min(1).max(100),
  "*": z.string(),
});

// File tree node — recursive
type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
};
export const fileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "folder"]),
    children: z.array(fileTreeNodeSchema).optional(),
  }),
);
export const fileTreeResponseSchema = z.array(fileTreeNodeSchema);

export const noteDataResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  title: z.string(),
  modifiedAt: z.union([z.string(), z.date()]),
});

export const noteCreatedResponseSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const noteUpdatedResponseSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const noteDeletedResponseSchema = z.object({
  message: z.string(),
});

export const noteRenamedResponseSchema = z.object({
  oldPath: z.string(),
  newPath: z.string(),
  message: z.string(),
});

export const sharedNoteResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  title: z.string(),
});
