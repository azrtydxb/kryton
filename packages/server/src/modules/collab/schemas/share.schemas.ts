import { z } from "zod";

export const permissionEnum = z.enum(["read", "readwrite"]);

export const createShareBodySchema = z.object({
  path: z.string().min(1).max(500),
  sharedWithUserId: z.string().min(1).max(100),
  permission: permissionEnum,
  isFolder: z.boolean().optional(),
});

export const updateShareBodySchema = z.object({
  permission: permissionEnum,
});

export const shareIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const shareSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  path: z.string(),
  isFolder: z.boolean(),
  sharedWithUserId: z.string(),
  permission: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  version: z.number().int(),
  cursor: z.string(), // bigint serialized
});

export const shareListSchema = z.array(shareSchema);

export const sharedWithMeItemSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  ownerName: z.string(),
  path: z.string(),
  isFolder: z.boolean(),
  permission: z.string(),
});

export const sharedWithMeListSchema = z.array(sharedWithMeItemSchema);

export const revokeShareResponseSchema = z.object({
  message: z.string(),
});

// --- Access Requests ---

export const createAccessRequestBodySchema = z.object({
  ownerUserId: z.string().min(1).max(100),
  notePath: z.string().min(1).max(500),
  message: z.string().max(500).optional(),
});

export const updateAccessRequestBodySchema = z.object({
  action: z.enum(["approve", "deny"]),
  permission: permissionEnum.optional(),
});

export const accessRequestIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const accessRequestSchema = z.object({
  id: z.string(),
  requesterUserId: z.string(),
  ownerUserId: z.string(),
  notePath: z.string(),
  status: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const accessRequestWithRequesterSchema = accessRequestSchema.extend({
  requester: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
});

export const accessRequestListSchema = z.array(accessRequestSchema);
export const pendingAccessRequestListSchema = z.array(accessRequestWithRequesterSchema);
