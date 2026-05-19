import { z } from "zod";

export const createApiKeyBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  scope: z.enum(["read-only", "read-write"]),
  agentId: z.string().min(1).optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .refine(
      (val) => !val || new Date(val) > new Date(),
      "Expiration date must be in the future",
    ),
});

export const apiKeyIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const createApiKeyResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  keyPrefix: z.string(),
  name: z.string(),
  scope: z.string(),
  agentId: z.string().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

export const apiKeyListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scope: z.string(),
  agentId: z.string().nullable(),
  expiresAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const listApiKeysResponseSchema = z.array(apiKeyListItemSchema);
