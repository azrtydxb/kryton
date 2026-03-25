import { z } from "zod";

// --- Note schemas ---
export const createNoteSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000),
});

export const updateNoteSchema = z.object({
  content: z.string().max(1_000_000),
});

export const renameNoteSchema = z.object({
  newPath: z.string().min(1).max(500),
});

// --- Folder schemas ---
export const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
});

export const renameFolderSchema = z.object({
  newPath: z.string().min(1).max(500),
});

// --- Canvas schemas ---
export const createCanvasSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.unknown().optional(),
});

// --- Settings schemas ---
export const updateSettingSchema = z.object({
  value: z.string(),
});

// --- Share schemas ---
export const createShareSchema = z.object({
  path: z.string().min(1).max(500),
  sharedWithUserId: z.string().min(1).max(100),
  permission: z.enum(["read", "readwrite"]),
  isFolder: z.boolean().optional(),
});

export const updateShareSchema = z.object({
  permission: z.enum(["read", "readwrite"]),
});

// --- Access request schemas ---
export const createAccessRequestSchema = z.object({
  ownerUserId: z.string().min(1).max(100),
  notePath: z.string().min(1).max(500),
  message: z.string().max(500).optional(),
});

export const updateAccessRequestSchema = z.object({
  action: z.enum(["approve", "deny"]),
  permission: z.enum(["read", "readwrite"]).optional(),
});

// --- Admin schemas ---
export const updateUserSchema = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(["user", "admin"]).optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(72),
});

export const createInviteSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});

export const registrationModeSchema = z.object({
  mode: z.enum(["open", "invite-only"]),
});

// API Key schemas
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  scope: z.enum(["read-only", "read-write"]),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .refine(
      (val) => !val || new Date(val) > new Date(),
      "Expiration date must be in the future",
    ),
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
