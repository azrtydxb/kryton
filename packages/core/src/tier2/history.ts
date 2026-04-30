// packages/core/src/tier2/history.ts
import type { SqliteAdapter } from "../adapter";

export interface NoteRevision {
  id: string;
  userId: string;
  notePath: string;
  content: string;
  createdAt: number;
}

export interface HistoryFetcherOpts {
  db: SqliteAdapter;
  fetchTier2: (
    entityType: string,
    parentId: string,
  ) => Promise<{ entities: NoteRevision[] }>;
  ttlMs: number;
}

export class HistoryFetcher {
  constructor(private opts: HistoryFetcherOpts) {}

  async list(notePath: string): Promise<NoteRevision[]> {
    const meta = this.opts.db.get<{ fetched_at: number }>(
      `SELECT fetched_at FROM tier2_cache_meta WHERE entity_type = ? AND parent_id = ?`,
      ["history", notePath],
    );
    const cacheValid = meta && Date.now() - meta.fetched_at < this.opts.ttlMs;
    if (cacheValid) {
      return this.opts.db.all<NoteRevision>(
        `SELECT * FROM note_revision WHERE notePath = ? ORDER BY createdAt DESC`,
        [notePath],
      );
    }
    const fresh = await this.opts.fetchTier2("history", notePath);
    this.opts.db.transaction(() => {
      this.opts.db.run(
        `DELETE FROM note_revision WHERE notePath = ?`,
        [notePath],
      );
      for (const r of fresh.entities) {
        this.opts.db.run(
          `INSERT INTO note_revision (id, userId, notePath, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
          [r.id, r.userId, r.notePath, r.content, r.createdAt],
        );
      }
      const now = Date.now();
      this.opts.db.run(
        `INSERT INTO tier2_cache_meta (entity_type, parent_id, fetched_at, accessed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (entity_type, parent_id) DO UPDATE SET fetched_at = excluded.fetched_at, accessed_at = excluded.accessed_at`,
        ["history", notePath, now, now],
      );
    });
    return fresh.entities;
  }

  async fetch(notePath: string): Promise<NoteRevision[]> {
    // Force a refetch by removing the cache entry
    this.opts.db.run(
      `DELETE FROM tier2_cache_meta WHERE entity_type = ? AND parent_id = ?`,
      ["history", notePath],
    );
    return this.list(notePath);
  }
}
