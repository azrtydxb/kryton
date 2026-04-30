// packages/core/src/__tests__/storage.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAdapter } from "../adapters/in-memory";
import { LocalStorage } from "../storage";

describe("LocalStorage", () => {
  let db: InMemoryAdapter;
  let s: LocalStorage;

  beforeEach(() => {
    db = new InMemoryAdapter();
    db.exec(`CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    s = new LocalStorage(db);
  });

  it("returns default for missing key", () => {
    expect(s.get("server_cursor", "0")).toBe("0");
  });

  it("set then get round-trip", () => {
    s.set("server_cursor", "123");
    expect(s.get("server_cursor", "0")).toBe("123");
  });

  it("set is idempotent (upsert)", () => {
    s.set("k", "1");
    s.set("k", "2");
    expect(s.get("k", "")).toBe("2");
  });
});
