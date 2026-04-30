// packages/core/src/bootstrap.ts
import type { SqliteAdapter } from "./adapter";

export function applySchema(db: SqliteAdapter, schemaSql: string): void {
  db.exec(schemaSql);
}
