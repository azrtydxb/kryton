import { describe, it, expect } from "vitest";
import { createDocument } from "../document";

describe("Document", () => {
  it("exposes the source text and length", () => {
    const d = createDocument("hello world");
    expect(d.text).toBe("hello world");
    expect(d.length).toBe(11);
  });

  it("slice extracts substrings inclusive-start, exclusive-end", () => {
    const d = createDocument("hello world");
    expect(d.slice(0, 5)).toBe("hello");
    expect(d.slice(6, 11)).toBe("world");
    expect(d.slice(0, 0)).toBe("");
  });

  it("replace produces a new document and leaves the original unchanged", () => {
    const a = createDocument("hello world");
    const b = a.replace(6, 11, "earth");
    expect(b.text).toBe("hello earth");
    expect(a.text).toBe("hello world");
  });

  it("replace at the end appends", () => {
    const d = createDocument("abc").replace(3, 3, "def");
    expect(d.text).toBe("abcdef");
  });

  it("lineAt returns the line containing the offset (1-based)", () => {
    const d = createDocument("a\nbb\nccc");
    expect(d.lineAt(0)).toEqual({ number: 1, from: 0, to: 1, text: "a" });
    expect(d.lineAt(2)).toEqual({ number: 2, from: 2, to: 4, text: "bb" });
    expect(d.lineAt(7)).toEqual({ number: 3, from: 5, to: 8, text: "ccc" });
  });

  it("rejects out-of-range slice", () => {
    const d = createDocument("hello");
    expect(() => d.slice(-1, 3)).toThrow();
    expect(() => d.slice(0, 99)).toThrow();
    expect(() => d.slice(3, 1)).toThrow();
  });
});
