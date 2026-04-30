// packages/core/src/query/graph-edges.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface GraphEdge {
  id: string;
  fromPath: string;
  toPath: string;
  fromNoteId: string;
  toNoteId: string;
  userId: string;
  version: number;
  cursor: number;
}

export class GraphEdgesRepository extends BaseRepository<GraphEdge> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "graph_edges",
      table: "graph_edge",
      columns: ["id", "fromPath", "toPath", "fromNoteId", "toNoteId", "userId", "cursor"] as const,
    });
  }
}
