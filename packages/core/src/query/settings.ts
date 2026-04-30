// packages/core/src/query/settings.ts
// Settings uses a composite PK (key, userId) rather than a single `id` column.
// We expose a thin wrapper around the adapter directly rather than subclassing BaseRepository,
// which requires an `id` field. Simple key–value get/set is all callers need.
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";
import type { Settings } from "../generated/types";

export type { Settings };

export class SettingsRepository {
  private readonly entityType = "settings";

  constructor(private db: SqliteAdapter, private bus: EventBus<any>) {}

  /** Get a single setting for a user. */
  get(userId: string, key: string): Settings | undefined {
    return this.db.get<Settings>(
      `SELECT * FROM settings WHERE userId = ? AND key = ? AND _local_status != 'deleted'`,
      [userId, key]
    );
  }

  /** Upsert a setting value. */
  set(userId: string, key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, userId, value, updatedAt, version, cursor, _local_status, _local_seq)
       VALUES (?, ?, ?, ?, 0, 0, 'created', 1)
       ON CONFLICT(key, userId) DO UPDATE SET
         value = excluded.value,
         updatedAt = excluded.updatedAt,
         _local_status = CASE _local_status WHEN 'created' THEN 'created' ELSE 'updated' END,
         _local_seq = _local_seq + 1`,
      [key, userId, value, Date.now()]
    );
    this.bus.emit("change", { entityType: this.entityType, ids: [`${userId}:${key}`], source: "local" });
  }

  /** List all settings for a user. */
  listForUser(userId: string): Settings[] {
    return this.db.all<Settings>(
      `SELECT * FROM settings WHERE userId = ? AND _local_status != 'deleted'`,
      [userId]
    );
  }

  /** Internal: bulk-apply pulled changes. */
  applyPulledChanges(
    created: Array<Record<string, unknown>>,
    updated: Array<Record<string, unknown>>,
    deleted: string[]
  ): void {
    this.db.transaction(() => {
      for (const row of created) {
        this.db.run(
          `INSERT OR REPLACE INTO settings (key, userId, value, updatedAt, version, cursor, _local_status, _local_seq)
           VALUES (?, ?, ?, ?, ?, ?, 'synced', 0)`,
          [row.key, row.userId, row.value, row.updatedAt, row.version ?? 0, row.cursor ?? 0]
        );
      }
      for (const row of updated) {
        const cur = this.db.get<{ _local_status: string }>(
          `SELECT _local_status FROM settings WHERE key = ? AND userId = ?`, [row.key, row.userId]
        );
        if (cur && cur._local_status !== "synced") continue;
        this.db.run(
          `UPDATE settings SET value = ?, updatedAt = ?, version = ?, cursor = ?, _local_status = 'synced'
           WHERE key = ? AND userId = ?`,
          [row.value, row.updatedAt, row.version ?? 0, row.cursor ?? 0, row.key, row.userId]
        );
      }
      for (const compositeId of deleted) {
        // compositeId format: "userId:key"
        const [userId, key] = compositeId.split(":");
        this.db.run(
          `DELETE FROM settings WHERE userId = ? AND key = ? AND _local_status = 'synced'`,
          [userId, key]
        );
      }
    });
    const ids = [
      ...created.map(r => `${r.userId}:${r.key}`),
      ...updated.map(r => `${r.userId}:${r.key}`),
      ...deleted,
    ];
    if (ids.length > 0) {
      this.bus.emit("change", { entityType: this.entityType, ids, source: "sync" });
    }
  }

  /** Internal: collect pending changes for push. */
  collectPendingChanges(): {
    created: Settings[];
    updated: Array<{ row: Settings; baseVersion: number }>;
    deleted: string[];
  } {
    const allPending = this.db.all<Settings & { _local_status: string }>(
      `SELECT * FROM settings WHERE _local_status != 'synced'`
    );
    const created: Settings[] = [];
    const updated: Array<{ row: Settings; baseVersion: number }> = [];
    const deleted: string[] = [];
    for (const row of allPending) {
      if (row._local_status === "created") created.push(row);
      else if (row._local_status === "updated") updated.push({ row, baseVersion: row.version });
      else if (row._local_status === "deleted") deleted.push(`${row.userId}:${row.key}`);
    }
    return { created, updated, deleted };
  }

  /** Internal: mark synced after push. */
  markSynced(ids: string[], versionById: Record<string, number>): void {
    this.db.transaction(() => {
      for (const compositeId of ids) {
        const [userId, key] = compositeId.split(":");
        const v = versionById[compositeId] ?? 0;
        this.db.run(
          `UPDATE settings SET _local_status = 'synced', version = ? WHERE userId = ? AND key = ?`,
          [v, userId, key]
        );
      }
    });
  }
}
