// packages/core/src/query/__tests__/installed-plugins.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { InstalledPluginsRepository } from "../installed-plugins";
import { EventBus } from "../../events";

describe("InstalledPluginsRepository", () => {
  it("create + findById round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE installed_plugin (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      author TEXT NOT NULL,
      state TEXT NOT NULL,
      error TEXT,
      manifest TEXT,
      enabled INTEGER NOT NULL,
      installedAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      schemaVersion INTEGER NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0
    )`);
    const repo = new InstalledPluginsRepository(db, new EventBus());
    repo.create({
      id: "p1", name: "my-plugin", version: "1.0.0",
      description: "A plugin", author: "Dev",
      state: "active", error: null, manifest: null,
      enabled: 1 as any, installedAt: 0, updatedAt: 0,
      schemaVersion: 1, cursor: 0,
    });
    expect(repo.findById("p1")?.name).toBe("my-plugin");
  });
});
