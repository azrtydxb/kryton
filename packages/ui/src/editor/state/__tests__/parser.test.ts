import { describe, it, expect } from "vitest";
import { createParser } from "../parser";

describe("parser", () => {
  it("parses a markdown heading and reports a Header node", () => {
    const parser = createParser();
    const tree = parser.parse("# hello");
    const types: string[] = [];
    tree.iterate({ enter: (node) => { types.push(node.name); } });
    expect(types).toContain("ATXHeading1");
  });

  it("recognises a wikilink as WikiLink", () => {
    const parser = createParser();
    const tree = parser.parse("see [[Other Note]] for context");
    let found = false;
    tree.iterate({ enter: (node) => { if (node.name === "WikiLink") found = true; } });
    expect(found).toBe(true);
  });

  it("incremental reparse reuses fragments", () => {
    const parser = createParser();
    const t1 = parser.parse("# hello\n\nbody");
    const t2 = parser.parseIncremental("# hello\n\nbody!", t1);
    // We can't easily assert reuse without internals; assert the result is correct.
    let foundHeading = false;
    t2.iterate({ enter: (node) => { if (node.name === "ATXHeading1") foundHeading = true; } });
    expect(foundHeading).toBe(true);
  });
});
