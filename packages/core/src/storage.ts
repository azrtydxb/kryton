// packages/core/src/storage.ts
import type { SqliteAdapter } from "./adapter";

export class LocalStorage {
  constructor(private db: SqliteAdapter) {}

  get(key: string, defaultValue: string): string {
    const r = this.db.get<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]);
    return r?.value ?? defaultValue;
  }

  set(key: string, value: string): void {
    this.db.run(
      "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }
}
