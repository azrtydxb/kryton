// packages/core/src/tier2/plugin-data.ts
import type { SqliteAdapter } from "../adapter";

export interface PluginDataFetcherOpts {
  db: SqliteAdapter;
  fetchTier2: (
    entityType: string,
    parentId: string,
  ) => Promise<{ entities: PluginStorageEntry[] }>;
  ttlMs: number;
}

export interface PluginStorageEntry {
  pluginId: string;
  key: string;
  userId: string;
  value: unknown;
  updatedAt: number;
  version: number;
}

export class PluginDataFetcher {
  constructor(private opts: PluginDataFetcherOpts) {
    opts.db.exec(`CREATE TABLE IF NOT EXISTS plugin_storage_cache (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, key, user_id)
    )`);
  }

  async list(pluginId: string): Promise<PluginStorageEntry[]> {
    const meta = this.opts.db.get<{ fetched_at: number }>(
      `SELECT fetched_at FROM plugin_storage_cache WHERE plugin_id = ? LIMIT 1`,
      [pluginId],
    );
    const cacheValid = meta && Date.now() - meta.fetched_at < this.opts.ttlMs;
    if (cacheValid) {
      return this.opts.db
        .all<{
          plugin_id: string;
          key: string;
          user_id: string;
          value: string;
          updated_at: number;
          version: number;
        }>(
          `SELECT * FROM plugin_storage_cache WHERE plugin_id = ?`,
          [pluginId],
        )
        .map((r) => ({
          pluginId: r.plugin_id,
          key: r.key,
          userId: r.user_id,
          value: JSON.parse(r.value) as unknown,
          updatedAt: r.updated_at,
          version: r.version,
        }));
    }
    const fresh = await this.opts.fetchTier2("plugin-data", pluginId);
    const now = Date.now();
    this.opts.db.transaction(() => {
      this.opts.db.run(
        `DELETE FROM plugin_storage_cache WHERE plugin_id = ?`,
        [pluginId],
      );
      for (const e of fresh.entities) {
        this.opts.db.run(
          `INSERT INTO plugin_storage_cache (plugin_id, key, user_id, value, updated_at, version, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            e.pluginId,
            e.key,
            e.userId,
            JSON.stringify(e.value),
            e.updatedAt,
            e.version,
            now,
          ],
        );
      }
    });
    return fresh.entities;
  }
}
