// packages/core/src/query/trash-items.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface TrashItem {
  id: string;
  originalPath: string;
  userId: string;
  trashedAt: number;
  version: number;
  cursor: number;
}

export class TrashItemsRepository extends BaseRepository<TrashItem> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "trash_items",
      table: "trash_item",
      columns: ["id", "originalPath", "userId", "trashedAt", "cursor"] as const,
    });
  }
}
