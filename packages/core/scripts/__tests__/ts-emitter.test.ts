import { describe, it, expect } from "vitest";
import { emitInterface } from "../lib/ts-emitter";

describe("emitInterface", () => {
  it("emits typed interface", () => {
    const out = emitInterface({
      name: "Note",
      tier: "tier1",
      parent: null,
      fields: [
        { name: "id", prismaType: "String", optional: false, isArray: false, attrs: ["@id"], default: undefined, isId: true },
        { name: "title", prismaType: "String", optional: false, isArray: false, attrs: [], default: undefined, isId: false },
        { name: "tags", prismaType: "String", optional: false, isArray: true, attrs: [], default: undefined, isId: false },
        { name: "createdAt", prismaType: "DateTime", optional: false, isArray: false, attrs: [], default: undefined, isId: false },
        { name: "subtitle", prismaType: "String", optional: true, isArray: false, attrs: [], default: undefined, isId: false },
      ],
    });
    expect(out).toContain("export interface Note {");
    expect(out).toContain("  id: string;");
    expect(out).toContain("  title: string;");
    expect(out).toContain("  tags: string[];");
    expect(out).toContain("  createdAt: number;");
    expect(out).toContain("  subtitle: string | null;");
    expect(out).toContain("  version: number;");
  });
});
