import { describe, it, expect } from "vitest";
import { emitTableDDL } from "../lib/sql-emitter";

describe("emitTableDDL", () => {
  it("emits required string with id", () => {
    const ddl = emitTableDDL({
      name: "Settings",
      tier: "tier1",
      parent: null,
      fields: [
        { name: "id", prismaType: "String", optional: false, isArray: false, attrs: ["@id"], default: undefined, isId: true },
        { name: "key", prismaType: "String", optional: false, isArray: false, attrs: [], default: undefined, isId: false },
        { name: "value", prismaType: "String", optional: true, isArray: false, attrs: [], default: undefined, isId: false },
        { name: "updatedAt", prismaType: "DateTime", optional: false, isArray: false, attrs: ["@updatedAt"], default: undefined, isId: false },
      ],
    });
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS settings (");
    expect(ddl).toContain("  id TEXT NOT NULL PRIMARY KEY,");
    expect(ddl).toContain("  key TEXT NOT NULL,");
    expect(ddl).toContain("  value TEXT,");
    expect(ddl).toContain("  updatedAt INTEGER NOT NULL,");
    expect(ddl).toContain("  _local_status TEXT NOT NULL DEFAULT 'synced',");
    expect(ddl).toContain("  _local_seq INTEGER NOT NULL DEFAULT 0,");
    expect(ddl).toContain("  version INTEGER NOT NULL DEFAULT 0");
  });

  it("emits string array as TEXT (JSON)", () => {
    const ddl = emitTableDDL({
      name: "Note",
      tier: "tier1",
      parent: null,
      fields: [
        { name: "id", prismaType: "String", optional: false, isArray: false, attrs: ["@id"], default: undefined, isId: true },
        { name: "tags", prismaType: "String", optional: false, isArray: true, attrs: [], default: undefined, isId: false },
      ],
    });
    expect(ddl).toContain("  tags TEXT NOT NULL,");
  });
});
