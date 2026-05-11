import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { AppError, NotFoundError } from "../../../lib/errors.js";
import { apiKey } from "../../../db/schema/auth.js";

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
 * `app.db` (Drizzle) for all DB access — no module-level singleton.
 */
export class ApiKeyService {
  constructor(private readonly app: FastifyInstance) {}

  async create(
    userId: string,
    name: string,
    scope: string,
    expiresAt: Date | null,
  ): Promise<CreatedApiKey> {
    const countRow = await this.app.db
      .select({ c: count() })
      .from(apiKey)
      .where(eq(apiKey.userId, userId));
    const existing = Number(countRow[0]?.c ?? 0);
    if (existing >= MAX_KEYS_PER_USER) {
      throw new AppError(
        "Maximum of 10 API keys per user reached",
        400,
        "KEY_LIMIT_EXCEEDED",
      );
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = buildKeyPrefix(rawKey);

    const [record] = await this.app.db
      .insert(apiKey)
      .values({ userId, name, keyHash, keyPrefix, scope, expiresAt })
      .returning();

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
    return this.app.db.query.apiKey.findMany({
      where: eq(apiKey.userId, userId),
      columns: {
        id: true,
        name: true,
        keyPrefix: true,
        scope: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: [desc(apiKey.createdAt)],
    });
  }

  async revoke(userId: string, keyId: string): Promise<void> {
    const key = await this.app.db.query.apiKey.findFirst({
      where: eq(apiKey.id, keyId),
    });
    if (!key || key.userId !== userId) {
      throw new NotFoundError("API key not found");
    }
    await this.app.db.delete(apiKey).where(eq(apiKey.id, keyId));
  }

  async validate(rawKey: string): Promise<ValidatedApiKey | null> {
    const keyHash = hashApiKey(rawKey);
    const record = await this.app.db.query.apiKey.findFirst({
      where: eq(apiKey.keyHash, keyHash),
    });

    if (!record) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // Update lastUsedAt (fire-and-forget)
    void this.app.db
      .update(apiKey)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKey.id, record.id))
      .then(
        () => undefined,
        () => undefined,
      );

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
