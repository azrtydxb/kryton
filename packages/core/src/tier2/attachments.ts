// packages/core/src/tier2/attachments.ts
import type { SqliteAdapter } from "../adapter";

export interface AttachmentsFetcherOpts {
  db: SqliteAdapter;
  fetchAttachment: (
    id: string,
  ) => Promise<{ blob: Uint8Array; mimeType: string; contentHash: string }>;
}

export class AttachmentsFetcher {
  constructor(private opts: AttachmentsFetcherOpts) {
    opts.db.exec(`CREATE TABLE IF NOT EXISTS attachment_cache (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      blob BLOB NOT NULL,
      accessed_at INTEGER NOT NULL
    )`);
  }

  async fetch(id: string): Promise<{ blob: Uint8Array; mimeType: string }> {
    const cached = this.opts.db.get<{ blob: Buffer; mime_type: string }>(
      "SELECT blob, mime_type FROM attachment_cache WHERE id = ?",
      [id],
    );
    if (cached) {
      this.opts.db.run(
        "UPDATE attachment_cache SET accessed_at = ? WHERE id = ?",
        [Date.now(), id],
      );
      return { blob: new Uint8Array(cached.blob), mimeType: cached.mime_type };
    }
    const fresh = await this.opts.fetchAttachment(id);
    this.opts.db.run(
      "INSERT INTO attachment_cache (id, content_hash, mime_type, blob, accessed_at) VALUES (?, ?, ?, ?, ?)",
      [id, fresh.contentHash, fresh.mimeType, Buffer.from(fresh.blob), Date.now()],
    );
    return { blob: fresh.blob, mimeType: fresh.mimeType };
  }

  /** Remove attachments not accessed within the given number of milliseconds. */
  evict(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    this.opts.db.run(
      "DELETE FROM attachment_cache WHERE accessed_at < ?",
      [cutoff],
    );
  }
}
