// packages/core/src/query/base.ts
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

interface CoreEvents {
  change: { entityType: string; ids: string[]; source: "local" | "sync" | "yjs" };
}

export interface BaseRepoOpts<T> {
  db: SqliteAdapter;
  bus: EventBus<any>;
  entityType: string;
  table: string;
  columns: ReadonlyArray<keyof T & string>;
}

export class BaseRepository<T extends { id: string; version: number | string }> {
  constructor(protected opts: BaseRepoOpts<T>) {}

  protected get db() { return this.opts.db; }

  findById(id: string): T | undefined {
    return this.db.get<T>(
      `SELECT * FROM ${this.opts.table} WHERE id = ? AND _local_status != 'deleted'`,
      [id]
    );
  }

  list(): T[] {
    return this.db.all<T>(
      `SELECT * FROM ${this.opts.table} WHERE _local_status != 'deleted'`
    );
  }

  create(input: T): T {
    const cols = this.opts.columns;
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map(c => (input as any)[c]);
    this.db.run(
      `INSERT INTO ${this.opts.table} (${cols.join(", ")}, _local_status, _local_seq, version)
       VALUES (${placeholders}, 'created', 1, 0)`,
      values
    );
    this.opts.bus.emit("change", {
      entityType: this.opts.entityType, ids: [input.id], source: "local",
    });
    return this.findById(input.id) as T;
  }

  update(id: string, patch: Partial<T>): T | undefined {
    const keys = Object.keys(patch).filter(k => (this.opts.columns as readonly string[]).includes(k));
    if (keys.length === 0) return this.findById(id);
    const setClause = keys.map(k => `${k} = ?`).join(", ");
    const values = keys.map(k => (patch as any)[k]);
    this.db.run(
      `UPDATE ${this.opts.table}
       SET ${setClause},
           _local_seq = _local_seq + 1,
           _local_status = CASE _local_status WHEN 'created' THEN 'created' ELSE 'updated' END
       WHERE id = ? AND _local_status != 'deleted'`,
      [...values, id]
    );
    this.opts.bus.emit("change", {
      entityType: this.opts.entityType, ids: [id], source: "local",
    });
    return this.findById(id);
  }

  delete(id: string): void {
    this.db.run(
      `UPDATE ${this.opts.table}
       SET _local_status = 'deleted', _local_seq = _local_seq + 1
       WHERE id = ?`, [id]
    );
    this.opts.bus.emit("change", {
      entityType: this.opts.entityType, ids: [id], source: "local",
    });
  }

  /** Internal: bulk-apply rows from sync pull, marking them as synced. */
  applyPulledChanges(
    created: Array<Record<string, unknown>>,
    updated: Array<Record<string, unknown>>,
    deleted: string[]
  ): void {
    const cols = this.opts.columns;
    this.db.transaction(() => {
      for (const row of created) {
        const placeholders = cols.map(() => "?").join(", ");
        const values = cols.map(c => row[c]);
        this.db.run(
          `INSERT OR REPLACE INTO ${this.opts.table} (${cols.join(", ")}, _local_status, _local_seq, version)
           VALUES (${placeholders}, 'synced', 0, ?)`,
          [...values, row.version ?? 0]
        );
      }
      for (const row of updated) {
        // Only overwrite if local row is synced (don't clobber pending local changes)
        const cur = this.db.get<{ _local_status: string }>(
          `SELECT _local_status FROM ${this.opts.table} WHERE id = ?`, [row.id]
        );
        if (cur && cur._local_status !== "synced") continue;
        const setClause = cols.map(c => `${c} = ?`).join(", ");
        const values = cols.map(c => row[c]);
        this.db.run(
          `UPDATE ${this.opts.table}
           SET ${setClause}, _local_status = 'synced', version = ?
           WHERE id = ?`,
          [...values, row.version ?? 0, row.id]
        );
      }
      for (const id of deleted) {
        this.db.run(
          `DELETE FROM ${this.opts.table} WHERE id = ? AND _local_status = 'synced'`,
          [id]
        );
      }
    });
    const ids = [
      ...created.map(r => String(r.id)),
      ...updated.map(r => String(r.id)),
      ...deleted,
    ];
    if (ids.length > 0) {
      this.opts.bus.emit("change", { entityType: this.opts.entityType, ids, source: "sync" });
    }
  }

  /** Internal: collect rows that need to be pushed. */
  collectPendingChanges(): {
    created: T[];
    updated: Array<{ row: T; baseVersion: number }>;
    deleted: string[];
  } {
    const allPending = this.db.all<T & { _local_status: string; version: number }>(
      `SELECT * FROM ${this.opts.table} WHERE _local_status != 'synced'`
    );
    const created: T[] = [];
    const updated: Array<{ row: T; baseVersion: number }> = [];
    const deleted: string[] = [];
    for (const row of allPending) {
      if (row._local_status === "created") created.push(row);
      else if (row._local_status === "updated") updated.push({ row, baseVersion: row.version });
      else if (row._local_status === "deleted") deleted.push(row.id);
    }
    return { created, updated, deleted };
  }

  /** Internal: mark rows as synced after successful push. */
  markSynced(ids: string[], versionById: Record<string, number>): void {
    this.db.transaction(() => {
      for (const id of ids) {
        const v = versionById[id];
        this.db.run(
          `UPDATE ${this.opts.table}
           SET _local_status = 'synced', version = ?
           WHERE id = ?`,
          [v, id]
        );
      }
    });
  }
}
