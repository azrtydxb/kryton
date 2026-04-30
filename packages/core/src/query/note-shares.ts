// packages/core/src/query/note-shares.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface NoteShare {
  id: string;
  ownerUserId: string;
  path: string;
  isFolder: boolean;
  sharedWithUserId: string;
  permission: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  cursor: number;
}

export class NoteSharesRepository extends BaseRepository<NoteShare> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "note_shares",
      table: "note_share",
      columns: [
        "id", "ownerUserId", "path", "isFolder", "sharedWithUserId",
        "permission", "createdAt", "updatedAt", "cursor",
      ] as const,
    });
  }
}
