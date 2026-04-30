// packages/core/scripts/__tests__/annotation-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseAnnotations } from "../lib/annotation-parser";

describe("parseAnnotations", () => {
  it("returns null for non-sync annotation", () => {
    const block = `/// not a sync annotation\nmodel User { id String @id }`;
    expect(parseAnnotations(block)).toBeNull();
  });

  it("parses tier1", () => {
    const block = `/// @sync tier1\nmodel Settings { id String @id }`;
    expect(parseAnnotations(block)).toEqual({
      tier: "tier1",
      parent: null,
      excludeFields: [],
    });
  });

  it("parses tier2 with parent", () => {
    const block = `/// @sync tier2 parent=Note\nmodel NoteRevision { id String @id }`;
    expect(parseAnnotations(block)).toEqual({
      tier: "tier2",
      parent: "Note",
      excludeFields: [],
    });
  });

  it("parses exclude fields", () => {
    const block = [
      `/// @sync tier1`,
      `/// @sync.fields exclude=passwordHash,internalNote`,
      `model X { id String @id }`,
    ].join("\n");
    expect(parseAnnotations(block)).toEqual({
      tier: "tier1",
      parent: null,
      excludeFields: ["passwordHash", "internalNote"],
    });
  });
});
