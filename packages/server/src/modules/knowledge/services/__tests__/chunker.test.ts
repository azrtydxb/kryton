import { describe, expect, it } from "vitest";

import { chunkNote } from "../chunker.js";

describe("chunkNote", () => {
  it("emits a single chunk for a tiny body with title prefix", () => {
    const chunks = chunkNote("X", "hello");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.text).toBe("X\n\nhello");
  });

  it("emits a single title-only chunk for an empty body", () => {
    const chunks = chunkNote("X", "");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.text).toBe("X");
  });

  it("splits a long body into multiple bounded chunks with overlap", () => {
    // 50 paragraphs of ~20 words each ≈ 1000 tokens → ~4-5 chunks.
    const paragraphs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const words = Array.from({ length: 20 }, (_, j) => `p${i}w${j}`);
      paragraphs.push(words.join(" "));
    }
    const body = paragraphs.join("\n\n");
    const chunks = chunkNote("Title", body);

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should be bounded — give some headroom for the overlap
    // + title prefix + paragraph boundaries.
    for (const c of chunks) {
      const tokens = c.text.trim().split(/\s+/).length;
      expect(tokens).toBeLessThan(400);
    }

    // Adjacent chunks should share overlap content. Take the last 5 words
    // of chunk N (excluding title prefix) and check at least one appears
    // near the start of chunk N+1's body.
    const stripTitle = (text: string): string =>
      text.startsWith("Title\n\n") ? text.slice("Title\n\n".length) : text;
    for (let i = 0; i < chunks.length - 1; i++) {
      const prevBody = stripTitle(chunks[i]!.text);
      const nextBody = stripTitle(chunks[i + 1]!.text);
      const prevWords = prevBody.split(/\s+/);
      const tailSample = prevWords.slice(Math.max(0, prevWords.length - 5));
      const nextHead = nextBody.split(/\s+/).slice(0, 64).join(" ");
      const overlap = tailSample.some((w) => nextHead.includes(w));
      expect(overlap).toBe(true);
    }
  });

  it("keeps an oversized code fence intact in a single chunk", () => {
    // ~1000 token fence — well over CHUNK_TOKENS (256).
    const fenceWords = Array.from({ length: 1000 }, (_, i) => `tok${i}`).join(" ");
    const body = "```\n" + fenceWords + "\n```";
    const chunks = chunkNote("T", body);

    const fenceChunks = chunks.filter((c) => c.text.includes("```"));
    expect(fenceChunks).toHaveLength(1);
    const fenceChunk = fenceChunks[0]!;
    expect(fenceChunk.text).toContain("tok0");
    expect(fenceChunk.text).toContain("tok999");
    // Exactly one opening and one closing fence.
    const fenceMatches = fenceChunk.text.match(/```/g) ?? [];
    expect(fenceMatches).toHaveLength(2);
  });

  it("prepends the title to every chunk's text", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const words = Array.from({ length: 20 }, (_, j) => `p${i}w${j}`);
      paragraphs.push(words.join(" "));
    }
    const body = paragraphs.join("\n\n");
    const chunks = chunkNote("MyTitle", body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.startsWith("MyTitle\n\n")).toBe(true);
    }
  });

  it("caps at MAX_CHUNKS (64) for pathologically long notes", () => {
    // Build a body that would produce far more than 64 chunks.
    const paragraphs: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const words = Array.from({ length: 30 }, (_, j) => `p${i}w${j}`);
      paragraphs.push(words.join(" "));
    }
    const body = paragraphs.join("\n\n");
    const chunks = chunkNote("T", body);
    expect(chunks.length).toBeLessThanOrEqual(64);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
