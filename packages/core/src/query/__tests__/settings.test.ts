// packages/core/src/query/__tests__/settings.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { SettingsRepository } from "../settings";
import { EventBus } from "../../events";

describe("SettingsRepository", () => {
  it("set + get round-trip", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE settings (
      key TEXT NOT NULL,
      userId TEXT NOT NULL,
      value TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, userId)
    )`);
    const repo = new SettingsRepository(db, new EventBus());
    repo.set("u1", "theme", "dark");
    expect(repo.get("u1", "theme")?.value).toBe("dark");
  });

  it("listForUser returns only that user's settings", () => {
    const db = new InMemoryAdapter();
    db.exec(`CREATE TABLE settings (
      key TEXT NOT NULL,
      userId TEXT NOT NULL,
      value TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, userId)
    )`);
    const repo = new SettingsRepository(db, new EventBus());
    repo.set("u1", "a", "1");
    repo.set("u2", "b", "2");
    const result = repo.listForUser("u1");
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("a");
  });
});
