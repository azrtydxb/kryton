import { z } from "zod";

export const createAgentBodySchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
});

export const setPolicyBodySchema = z.object({
  policyText: z.string(),
});

export const mintTokenBodySchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  scope: z.string().optional(),
});

export const agentIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const tokenIdParamsSchema = z.object({
  tokenId: z.string().min(1),
});

export const agentSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  label: z.string(),
  policyText: z.string().nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date().nullable(),
});

export const listAgentsResponseSchema = z.object({
  agents: z.array(agentSchema),
});

export const mintTokenResponseSchema = z.object({
  token: z.string(),
  tokenId: z.string(),
  expiresAt: z.date(),
});
