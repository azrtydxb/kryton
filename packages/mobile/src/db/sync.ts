import { getDatabase } from "./index";
import { api } from "../lib/api";
import { storage } from "../lib/storage";

export async function syncWithServer(): Promise<void> {
  const db = getDatabase();
  const lastPulledAt = await storage.getLastSyncAt();

  // 1. PULL — get server changes
  const pullResponse = await api.syncPull(lastPulledAt);
  const { changes, timestamp } = pullResponse;

  // Apply server changes to local DB
  db.withTransactionSync(() => {
    for (const table of ["notes", "settings", "note_shares", "trash_items"]) {
      const tableChanges = changes[table];
      if (!tableChanges) continue;

      // Apply created records
      for (const record of tableChanges.created || []) {
        const columns = Object.keys(record).filter(k => k !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((k: string) => record[k]);
        db.runSync(
          `INSERT OR REPLACE INTO ${table} (id, ${columns.join(', ')}, _status, _changed) VALUES (?, ${placeholders}, 'synced', '')`,
          [record.id, ...values]
        );
      }

      // Apply updated records
      for (const record of tableChanges.updated || []) {
        const columns = Object.keys(record).filter(k => k !== 'id');
        const setClause = columns.map(k => `${k} = ?`).join(', ');
        const values = columns.map((k: string) => record[k]);
        db.runSync(
          `UPDATE ${table} SET ${setClause}, _status = 'synced', _changed = '' WHERE id = ? AND _status = 'synced'`,
          [...values, record.id]
        );
      }

      // Apply deleted records
      for (const id of tableChanges.deleted || []) {
        db.runSync(`DELETE FROM ${table} WHERE id = ? AND _status = 'synced'`, [id]);
      }
    }
  });

  // 2. PUSH — send local changes to server
  const localChanges: Record<string, { created: any[]; updated: any[]; deleted: string[] }> = {};

  for (const table of ["notes", "settings", "note_shares", "trash_items"]) {
    const created = db.getAllSync(`SELECT * FROM ${table} WHERE _status = 'created'`);
    const updated = db.getAllSync(`SELECT * FROM ${table} WHERE _status = 'updated'`);
    const deleted = db.getAllSync(`SELECT id FROM ${table} WHERE _status = 'deleted'`);

    // Strip _status and _changed from records before sending
    const clean = (rows: any[]) => rows.map(r => {
      const { _status, _changed, ...rest } = r;
      return rest;
    });

    localChanges[table] = {
      created: clean(created),
      updated: clean(updated),
      deleted: deleted.map((r: any) => r.id),
    };
  }

  const hasChanges = Object.values(localChanges).some(
    c => c.created.length > 0 || c.updated.length > 0 || c.deleted.length > 0
  );

  if (hasChanges) {
    await api.syncPush(localChanges, lastPulledAt);

    // Mark all pushed records as synced
    db.withTransactionSync(() => {
      for (const table of ["notes", "settings", "note_shares", "trash_items"]) {
        db.runSync(`UPDATE ${table} SET _status = 'synced', _changed = '' WHERE _status IN ('created', 'updated')`);
        db.runSync(`DELETE FROM ${table} WHERE _status = 'deleted'`);
      }
    });
  }

  // Save timestamp
  await storage.setLastSyncAt(timestamp);
}
