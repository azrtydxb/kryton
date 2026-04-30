// packages/core/src/query/notes.ts
import type { SqliteAdapter } from "../adapter";
import { BaseRepository } from "./base";
import type { EventBus } from "../events";

export interface Note {
  id: string;
  path: string;
  title: string;
  tags: string;       // JSON-stringified string[]
  modifiedAt: number;
  version: number;
}

export class NotesRepository extends BaseRepository<Note> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "notes",
      table: "note",
      columns: ["id", "path", "title", "tags", "modifiedAt"] as const,
    });
  }

  findByPath(path: string): Note | undefined {
    return this.db.get<Note>(
      `SELECT * FROM note WHERE path = ? AND _local_status != 'deleted'`, [path]
    );
  }

  listByFolder(prefix: string): Note[] {
    return this.db.all<Note>(
      `SELECT * FROM note WHERE path LIKE ? AND _local_status != 'deleted' ORDER BY path`,
      [`${prefix}%`]
    );
  }
}
