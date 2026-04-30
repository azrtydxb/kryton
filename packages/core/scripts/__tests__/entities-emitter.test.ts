import { describe, it, expect } from "vitest";
import { emitEntityMetadata } from "../lib/entities-emitter";

describe("emitEntityMetadata", () => {
  it("emits an array of entity descriptors", () => {
    const code = emitEntityMetadata([
      { name: "Note", tier: "tier1", parent: null, fields: [] },
      { name: "NoteRevision", tier: "tier2", parent: "Note", fields: [] },
    ]);
    expect(code).toContain('export const ENTITIES = [');
    expect(code).toContain('{ name: "Note", table: "note", tier: "tier1", parent: null }');
    expect(code).toContain('{ name: "NoteRevision", table: "note_revision", tier: "tier2", parent: "Note" }');
  });
});
