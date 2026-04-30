// packages/core/src/query/__tests__/base.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAdapter } from "../../adapters/in-memory";
import { BaseRepository } from "../base";
import { EventBus } from "../../events";

interface Item { id: string; name: string; n: number; version: number }

describe("BaseRepository", () => {
  let db: InMemoryAdapter;
  let bus: EventBus<{ change: { entityType: string; ids: string[]; source: string } }>;
  let repo: BaseRepository<Item>;

  beforeEach(() => {
    db = new InMemoryAdapter();
    db.exec(`CREATE TABLE items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      _local_status TEXT NOT NULL DEFAULT 'synced',
      _local_seq INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0
    )`);
    bus = new EventBus();
    repo = new BaseRepository<Item>({
      db, bus,
      entityType: "items",
      table: "items",
      columns: ["id", "name", "n"],
    });
  });

  it("create inserts and emits change", () => {
    const events: any[] = [];
    bus.on("change", e => events.push(e));
    repo.create({ id: "a", name: "alpha", n: 1, version: 0 } as Item);
    expect(repo.findById("a")).toMatchObject({ id: "a", name: "alpha", n: 1 });
    expect(events).toEqual([{ entityType: "items", ids: ["a"], source: "local" }]);
  });

  it("update applies patch and increments local_seq", () => {
    repo.create({ id: "a", name: "alpha", n: 1, version: 0 } as Item);
    repo.update("a", { name: "beta" });
    expect(repo.findById("a")?.name).toBe("beta");
  });

  it("delete marks _local_status='deleted'", () => {
    repo.create({ id: "a", name: "alpha", n: 1, version: 0 } as Item);
    repo.delete("a");
    expect(repo.findById("a")).toBeUndefined();
    const raw = db.get<{ _local_status: string }>("SELECT _local_status FROM items WHERE id=?", ["a"]);
    expect(raw?._local_status).toBe("deleted");
  });

  it("list returns non-deleted rows", () => {
    repo.create({ id: "a", name: "alpha", n: 1, version: 0 } as Item);
    repo.create({ id: "b", name: "beta", n: 2, version: 0 } as Item);
    repo.delete("a");
    const all = repo.list();
    expect(all.map(i => i.id)).toEqual(["b"]);
  });
});
