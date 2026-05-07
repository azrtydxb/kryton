import type { FastifyInstance } from "fastify";
import type { StorageEntry } from "./types.js";

const GLOBAL_USER = "";

type Prisma = FastifyInstance["prisma"];

/**
 * Plugin key-value storage. Backed by the `pluginStorage` Prisma model.
 * Receives the Prisma client via constructor so it stays decoupled from
 * any module-level singleton.
 */
export class PluginStorageService {
  constructor(private readonly prisma: Prisma) {}

  async get(pluginId: string, key: string, userId?: string): Promise<unknown> {
    const entry = await this.prisma.pluginStorage.findUnique({
      where: {
        pluginId_key_userId: {
          pluginId,
          key,
          userId: userId ?? GLOBAL_USER,
        },
      },
    });
    return entry?.value ?? null;
  }

  async set(
    pluginId: string,
    key: string,
    value: unknown,
    userId?: string,
  ): Promise<void> {
    const effectiveUserId = userId ?? GLOBAL_USER;
    await this.prisma.pluginStorage.upsert({
      where: {
        pluginId_key_userId: { pluginId, key, userId: effectiveUserId },
      },
      create: {
        pluginId,
        key,
        userId: effectiveUserId,
        value: value as Parameters<typeof this.prisma.pluginStorage.create>[0]["data"]["value"],
      },
      update: {
        value: value as Parameters<typeof this.prisma.pluginStorage.update>[0]["data"]["value"],
      },
    });
  }

  async delete(pluginId: string, key: string, userId?: string): Promise<void> {
    await this.prisma.pluginStorage.deleteMany({
      where: { pluginId, key, userId: userId ?? GLOBAL_USER },
    });
  }

  async list(
    pluginId: string,
    prefix?: string,
    userId?: string,
  ): Promise<StorageEntry[]> {
    const where: Record<string, unknown> = { pluginId };
    if (userId !== undefined) where.userId = userId;
    if (prefix) where.key = { startsWith: prefix };

    const entries = await this.prisma.pluginStorage.findMany({ where });
    return entries.map((e) => ({
      key: e.key,
      value: e.value,
      userId: e.userId || null,
    }));
  }
}
