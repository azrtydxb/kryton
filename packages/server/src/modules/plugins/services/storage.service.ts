import type { FastifyInstance } from "fastify";
import { and, eq, like } from "drizzle-orm";

import { pluginStorage } from "../../../db/schema/settings.js";
import type { StorageEntry } from "./types.js";

const GLOBAL_USER = "";

type Db = FastifyInstance["db"];

/**
 * Plugin key-value storage. Backed by the `pluginStorage` table.
 * Receives the Drizzle client via constructor so it stays decoupled from
 * any module-level singleton.
 */
export class PluginStorageService {
  constructor(private readonly db: Db) {}

  async get(pluginId: string, key: string, userId?: string): Promise<unknown> {
    const entry = await this.db.query.pluginStorage.findFirst({
      where: and(
        eq(pluginStorage.pluginId, pluginId),
        eq(pluginStorage.key, key),
        eq(pluginStorage.userId, userId ?? GLOBAL_USER),
      ),
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
    await this.db
      .insert(pluginStorage)
      .values({
        pluginId,
        key,
        userId: effectiveUserId,
        value: value as never,
      })
      .onConflictDoUpdate({
        target: [pluginStorage.pluginId, pluginStorage.key, pluginStorage.userId],
        set: {
          value: value as never,
          updatedAt: new Date(),
        },
      });
  }

  async delete(pluginId: string, key: string, userId?: string): Promise<void> {
    await this.db
      .delete(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, pluginId),
          eq(pluginStorage.key, key),
          eq(pluginStorage.userId, userId ?? GLOBAL_USER),
        ),
      );
  }

  async list(
    pluginId: string,
    prefix?: string,
    userId?: string,
  ): Promise<StorageEntry[]> {
    const conditions = [eq(pluginStorage.pluginId, pluginId)];
    if (userId !== undefined) conditions.push(eq(pluginStorage.userId, userId));
    if (prefix) conditions.push(like(pluginStorage.key, `${prefix}%`));

    const entries = await this.db
      .select()
      .from(pluginStorage)
      .where(and(...conditions));

    return entries.map((e) => ({
      key: e.key,
      value: e.value,
      userId: e.userId || null,
    }));
  }
}
