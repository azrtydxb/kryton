/**
 * OpenAPI-registered schemas for the plugin-builtin API surface.
 *
 * `NoteEntry` is the plugin-facing file-tree node. It uses `type: "file" |
 * "directory"` (vs the internal `FileTreeNode` which uses "folder") because
 * plugin consumers have always received "directory" for folders.
 */
import { z } from "zod";
import { sharedSchemaRegistry } from "../../../shared-schemas/index.js";

// Recursive NoteEntry — must be defined as a forward-ref then registered.
type NoteEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteEntry[];
};

const noteEntryBase: z.ZodType<NoteEntry> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "directory"]),
    children: z.array(noteEntryBase).optional(),
  }),
);

export const noteEntrySchema = noteEntryBase.register(sharedSchemaRegistry, {
  id: "NoteEntry",
});

export const noteEntryListSchema = z.array(noteEntrySchema);
