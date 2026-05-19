import { z } from "zod";
import { sharedSchemaRegistry } from "../../../shared-schemas/index.js";

// Note CRUD
export const createNoteBodySchema = z
  .object({
    path: z.string().min(1).max(500),
    content: z.string().max(1_000_000).optional(),
  })
  .register(sharedSchemaRegistry, { id: "CreateNoteBody" });

export const updateNoteBodySchema = z
  .object({
    content: z.string().max(1_000_000),
  })
  .register(sharedSchemaRegistry, { id: "UpdateNoteBody" });

export const renameNoteBodySchema = z
  .object({
    newPath: z.string().min(1).max(500),
  })
  .register(sharedSchemaRegistry, { id: "RenameNoteBody" });

export const wildcardPathParamsSchema = z.object({
  "*": z.string(),
});

export const sharedNotePathParamsSchema = z.object({
  ownerUserId: z.string().min(1).max(100),
  "*": z.string(),
});

// File tree node — recursive. `updatedAt` (ISO mtime) and `size` (bytes) are
// populated for files; folders omit them.
type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
  updatedAt?: string;
  size?: number;
};
const fileTreeNodeBase: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "folder"]),
    children: z.array(fileTreeNodeBase).optional(),
    updatedAt: z.string().optional(),
    size: z.number().optional(),
  }),
);
export const fileTreeNodeSchema = fileTreeNodeBase.register(sharedSchemaRegistry, {
  id: "FileTreeNode",
});
export const fileTreeResponseSchema = z.array(fileTreeNodeSchema);

export const noteDataResponseSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    title: z.string(),
    modifiedAt: z.union([z.string(), z.date()]),
  })
  .register(sharedSchemaRegistry, { id: "NoteDataResponse" });

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
