// packages/core/src/__tests__/bootstrap.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../adapters/in-memory";
import { applySchema } from "../bootstrap";

describe("applySchema", () => {
  it("creates expected core tables", () => {
    const db = new InMemoryAdapter();
    applySchema(db, "CREATE TABLE x (id INT); CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.run("INSERT INTO sync_state (key, value) VALUES (?, ?)", ["k", "v"]);
    expect(db.get("SELECT value FROM sync_state WHERE key=?", ["k"])).toEqual({ value: "v" });
  });

  it("is idempotent (CREATE TABLE IF NOT EXISTS)", () => {
    const db = new InMemoryAdapter();
    const sql = "CREATE TABLE IF NOT EXISTS x (id INT);";
    applySchema(db, sql);
    applySchema(db, sql); // does not throw
  });
});
