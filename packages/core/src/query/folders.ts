// packages/core/src/query/folders.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface Folder {
  id: string;
  userId: string;
  path: string;
  parentId: string | null;
  version: number;
  cursor: number;
  updatedAt: number;
}

export class FoldersRepository extends BaseRepository<Folder> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "folders",
      table: "folder",
      columns: ["id", "userId", "path", "parentId", "cursor", "updatedAt"] as const,
    });
  }
}
