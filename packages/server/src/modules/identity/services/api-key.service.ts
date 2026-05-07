import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError, NotFoundError } from "../../../lib/errors.js";

const KEY_PREFIX = "kryton_";
const KEY_BYTES = 32; // 256 bits of entropy
const MAX_KEYS_PER_USER = 10;

export interface CreatedApiKey {
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  scope: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ValidatedApiKey {
  keyId: string;
  userId: string;
  scope: string;
}

export function generateApiKey(): string {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("hex");
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function buildKeyPrefix(key: string): string {
  // "kryton_" (7 chars) + first 8 hex chars
  return key.substring(0, 7 + 8);
}

/**
 * API key service. Receives the Fastify instance via constructor and uses
 * `app.prisma` for all DB access — no module-level Prisma singleton.
 */
export class ApiKeyService {
  constructor(private readonly app: FastifyInstance) {}

  async create(
    userId: string,
    name: string,
    scope: string,
    expiresAt: Date | null,
  ): Promise<CreatedApiKey> {
    const count = await this.app.prisma.apiKey.count({ where: { userId } });
    if (count >= MAX_KEYS_PER_USER) {
      throw new AppError(
        "Maximum of 10 API keys per user reached",
        400,
        "KEY_LIMIT_EXCEEDED",
      );
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = buildKeyPrefix(rawKey);

    const record = await this.app.prisma.apiKey.create({
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

  async list(userId: string) {
    return this.app.prisma.apiKey.findMany({
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

  async revoke(userId: string, keyId: string): Promise<void> {
    const key = await this.app.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      throw new NotFoundError("API key not found");
    }
    await this.app.prisma.apiKey.delete({ where: { id: keyId } });
  }

  async validate(rawKey: string): Promise<ValidatedApiKey | null> {
    const keyHash = hashApiKey(rawKey);
    const record = await this.app.prisma.apiKey.findUnique({ where: { keyHash } });

    if (!record) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // Update lastUsedAt (fire-and-forget)
    this.app.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    return {
      keyId: record.id,
      userId: record.userId,
      scope: record.scope,
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    identity: {
      apiKey: ApiKeyService;
    };
  }
}
