// packages/core/src/query/installed-plugins.ts
import { BaseRepository } from "./base";
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  state: string;
  error: string | null;
  manifest: unknown | null;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  schemaVersion: number;
  cursor: number;
}

export class InstalledPluginsRepository extends BaseRepository<InstalledPlugin> {
  constructor(db: SqliteAdapter, bus: EventBus<any>) {
    super({
      db, bus,
      entityType: "installed_plugins",
      table: "installed_plugin",
      columns: [
        "id", "name", "version", "description", "author", "state",
        "error", "manifest", "enabled", "installedAt", "updatedAt",
        "schemaVersion", "cursor",
      ] as const,
    });
  }
}
