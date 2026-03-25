import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { AppError, NotFoundError } from "../lib/errors.js";

const KEY_PREFIX = "mnemo_";
const KEY_BYTES = 32; // 256 bits of entropy
const MAX_KEYS_PER_USER = 10;

export function generateApiKey(): string {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("hex");
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function buildKeyPrefix(key: string): string {
  // "mnemo_" (6 chars) + first 8 hex chars
  return key.substring(0, 6 + 8);
}

export async function createApiKey(
  userId: string,
  name: string,
  scope: string,
  expiresAt: Date | null,
): Promise<{ id: string; key: string; keyPrefix: string; name: string; scope: string; expiresAt: Date | null; createdAt: Date }> {
  const count = await prisma.apiKey.count({ where: { userId } });
  if (count >= MAX_KEYS_PER_USER) {
    throw new AppError("Maximum of 10 API keys per user reached", 400, "KEY_LIMIT_EXCEEDED");
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = buildKeyPrefix(rawKey);

  const record = await prisma.apiKey.create({
    data: { userId, name, keyHash, keyPrefix, scope, expiresAt },
  });

  return {
    id: record.id,
    key: rawKey,
    keyPrefix,
    name: record.name,
    scope: record.scope,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function listApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key || key.userId !== userId) {
    throw new NotFoundError("API key not found");
  }
  await prisma.apiKey.delete({ where: { id: keyId } });
}

export async function validateApiKey(rawKey: string): Promise<{
  keyId: string;
  userId: string;
  scope: string;
} | null> {
  const keyHash = hashApiKey(rawKey);
  const record = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!record) return null;

  if (record.expiresAt && record.expiresAt < new Date()) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    keyId: record.id,
    userId: record.userId,
    scope: record.scope,
  };
}
