import { describe, it, expect, beforeEach } from "vitest";
import type { SqliteAdapter } from "../adapter";

export function runConformanceSuite(name: string, factory: () => SqliteAdapter) {
  describe(`SqliteAdapter conformance: ${name}`, () => {
    let db: SqliteAdapter;

    beforeEach(() => {
      db = factory();
      db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          n INTEGER NOT NULL DEFAULT 0
        );
      `);
    });

    it("exec creates and drops a table", () => {
      db.exec("CREATE TABLE temp1 (x INTEGER)");
      db.exec("DROP TABLE temp1");
    });

    it("run inserts a row and returns changes=1", () => {
      const r = db.run("INSERT INTO items (id, name, n) VALUES (?, ?, ?)", ["a", "alpha", 1]);
      expect(r.changes).toBe(1);
    });

    it("get returns the inserted row", () => {
      db.run("INSERT INTO items (id, name, n) VALUES (?, ?, ?)", ["a", "alpha", 1]);
      const row = db.get<{ id: string; name: string; n: number }>(
        "SELECT * FROM items WHERE id = ?", ["a"]
      );
      expect(row).toEqual({ id: "a", name: "alpha", n: 1 });
    });

    it("get returns undefined for missing row", () => {
      const row = db.get("SELECT * FROM items WHERE id = ?", ["nope"]);
      expect(row).toBeUndefined();
    });

    it("all returns rows in insertion order", () => {
      db.run("INSERT INTO items (id, name, n) VALUES (?, ?, ?)", ["a", "alpha", 1]);
      db.run("INSERT INTO items (id, name, n) VALUES (?, ?, ?)", ["b", "beta", 2]);
      const rows = db.all<{ id: string }>("SELECT id FROM items ORDER BY id");
      expect(rows.map(r => r.id)).toEqual(["a", "b"]);
    });

    it("transaction commits on success", () => {
      db.transaction(() => {
        db.run("INSERT INTO items (id, name) VALUES (?, ?)", ["a", "alpha"]);
        db.run("INSERT INTO items (id, name) VALUES (?, ?)", ["b", "beta"]);
      });
      expect(db.all("SELECT * FROM items")).toHaveLength(2);
    });

    it("transaction rolls back on throw", () => {
      expect(() => {
        db.transaction(() => {
          db.run("INSERT INTO items (id, name) VALUES (?, ?)", ["a", "alpha"]);
          throw new Error("boom");
        });
      }).toThrow("boom");
      expect(db.all("SELECT * FROM items")).toHaveLength(0);
    });

    it("respects unique constraint", () => {
      db.run("INSERT INTO items (id, name) VALUES (?, ?)", ["a", "alpha"]);
      expect(() => db.run("INSERT INTO items (id, name) VALUES (?, ?)", ["a", "alpha"]))
        .toThrow();
    });

    it("close releases the database", () => {
      db.close();
      expect(() => db.run("SELECT 1", [])).toThrow();
    });
  });
}
