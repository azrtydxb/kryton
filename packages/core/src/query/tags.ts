// packages/core/src/query/tags.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  version: number;
  cursor: number;
  updatedAt: number;
}

export class TagsRepository extends BaseRepository<Tag> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "tags",
      table: "tag",
      columns: ["id", "userId", "name", "color", "cursor", "updatedAt"] as const,
    });
  }
}
