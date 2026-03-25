import { z } from "zod";

export const createNoteSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000),
});

export const updateNoteSchema = z.object({
  content: z.string().max(1_000_000),
});

export const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
});

export const updateSettingSchema = z.object({
  value: z.string(),
});

export const createShareSchema = z.object({
  path: z.string().min(1),
  sharedWithEmail: z.string().email(),
  permission: z.enum(["read", "read-write"]),
  isFolder: z.boolean().optional(),
});

// Helper to validate and return parsed body or send 400
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", "),
    };
  }
  return { success: true, data: result.data };
}
