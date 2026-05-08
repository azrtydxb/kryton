import { describe, it, expect } from "vitest";
import { createDocument } from "../document";
import { applyOps, type Operation } from "../operations";

describe("applyOps", () => {
  it("inserts text at offset", () => {
    const a = createDocument("hello");
    const ops: Operation[] = [{ kind: "insert", at: 5, text: "!" }];
    expect(applyOps(a, ops).text).toBe("hello!");
  });

  it("deletes a range", () => {
    const a = createDocument("hello world");
    const ops: Operation[] = [{ kind: "delete", from: 5, to: 11 }];
    expect(applyOps(a, ops).text).toBe("hello");
  });

  it("replaces a range", () => {
    const a = createDocument("hello world");
    const ops: Operation[] = [{ kind: "replace", from: 6, to: 11, text: "there" }];
    expect(applyOps(a, ops).text).toBe("hello there");
  });

  it("applies multiple ops left-to-right with offset shifting", () => {
    const a = createDocument("ab cd ef");
    const ops: Operation[] = [
      { kind: "insert", at: 0, text: ">> " }, // -> ">> ab cd ef"
      { kind: "insert", at: 5, text: "X" },   // offset 5 in NEW doc => after ">> ab"
    ];
    expect(applyOps(a, ops).text).toBe(">> abX cd ef");
  });

  it("rejects ops with mismatched ranges", () => {
    const a = createDocument("hi");
    expect(() => applyOps(a, [{ kind: "delete", from: 5, to: 10 }])).toThrow();
  });
});
