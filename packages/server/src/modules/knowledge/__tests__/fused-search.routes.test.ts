import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { user } from "../../../db/schema/auth.js";
import { searchIndex, graphEdge } from "../../../db/schema/notes.js";
import { noteEmbeddingChunk } from "../../../db/schema/embeddings.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

/**
 * GET /api/search — fused 3-layer Reciprocal Rank Fusion.
 *
 * Deterministic fake embedder keeps the suite fast and free of model
 * loading. Vectors are unit one-hots in 384-D so cosine similarity is
 * either exactly 1 (matching index) or 0 (orthogonal).
 */

const DIM = 384;

function oneHot(idx: number): Float32Array {
  const v = new Float32Array(DIM);
  v[idx] = 1;
  return v;
}

const TEST_USER = {
  id: "u-fused",
  email: "fused@example.com",
  name: "F",
  role: "user",
};

async function seedUser(handle: TestDbHandle): Promise<void> {
  await handle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
}

describe("knowledge / GET /api/search (fused)", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(() => {
    dbHandle = createKnowledgeTestDb();
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  beforeEach(async () => {
    await resetKnowledgeTestDb(dbHandle);
    await seedUser(dbHandle);
  });

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("falls back to lexical-only when embedder is off", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "alpha.md",
        userId: TEST_USER.id,
        title: "Alpha",
        content: "the rain in spain falls on the plain",
        tags: "[]",
        modifiedAt: now,
      },
      {
        notePath: "beta.md",
        userId: TEST_USER.id,
        title: "Beta",
        content: "nothing to see here",
        tags: "[]",
        modifiedAt: now,
      },
    ]);

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: { ready: false, provider: "off", dimensions: DIM },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=spain",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].path).toBe("alpha.md");
  });

  it("fused happy path: semantic boost lifts the closer note", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    // Both notes share a lexical token so they appear in lexical results
    // tied. The fake embedder maps the query to oneHot(0); near.md owns
    // oneHot(0), far.md owns oneHot(1). Sem rank should put near.md first.
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "near.md",
        userId: TEST_USER.id,
        title: "Near",
        content: "topic discussion goes here",
        tags: "[]",
        modifiedAt: now,
      },
      {
        notePath: "far.md",
        userId: TEST_USER.id,
        title: "Far",
        content: "topic discussion also here",
        tags: "[]",
        modifiedAt: now,
      },
    ]);

    await dbHandle.db.insert(noteEmbeddingChunk).values([
      {
        userId: TEST_USER.id,
        notePath: "near.md",
        chunkIndex: 0,
        chunkText: "this chunk is semantically nearest to the query vector",
        embedding: Array.from(oneHot(0)),
        modifiedAt: now,
      },
      {
        userId: TEST_USER.id,
        notePath: "far.md",
        chunkIndex: 0,
        chunkText: "this chunk is far from the query in vector space",
        embedding: Array.from(oneHot(1)),
        modifiedAt: now,
      },
    ]);

    const fakeEmbedder = {
      model: "fake-mini",
      dimensions: DIM,
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map(() => oneHot(0));
      },
      async embedQuery(_text: string): Promise<Float32Array> {
        return oneHot(0);
      },
    };

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: {
        ready: true,
        provider: "pgvector-local",
        model: "fake-mini",
        dimensions: DIM,
        embedder: fakeEmbedder,
      },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=topic",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0].path).toBe("near.md");
    // Snippet should be drawn from the best semantic chunk.
    expect(body[0].snippet).toContain("semantically nearest");
    expect(body[0].score).toBeGreaterThan(body[1].score);
    expect(typeof body[0].score).toBe("number");
  });

  it("graph boost: neighbour of a top hit gets ranked above an unconnected weak match", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    // top.md is the obvious lexical+semantic winner. neighbour.md has no
    // lexical match and no embedding (so no semantic match either) but is
    // graph-linked to top.md. loner.md has no lexical match, no embedding,
    // and no graph connection — it should not appear at all.
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "top.md",
        userId: TEST_USER.id,
        title: "Top",
        content: "marker keyword appears here",
        tags: "[]",
        modifiedAt: now,
      },
      {
        notePath: "neighbour.md",
        userId: TEST_USER.id,
        title: "Neighbour",
        content: "unrelated prose",
        tags: "[]",
        modifiedAt: now,
      },
      {
        notePath: "loner.md",
        userId: TEST_USER.id,
        title: "Loner",
        content: "also unrelated",
        tags: "[]",
        modifiedAt: now,
      },
    ]);

    await dbHandle.db.insert(noteEmbeddingChunk).values([
      {
        userId: TEST_USER.id,
        notePath: "top.md",
        chunkIndex: 0,
        chunkText: "top chunk text",
        embedding: Array.from(oneHot(0)),
        modifiedAt: now,
      },
    ]);

    await dbHandle.db.insert(graphEdge).values([
      {
        userId: TEST_USER.id,
        fromPath: "top.md",
        toPath: "neighbour.md",
        fromNoteId: "n-top",
        toNoteId: "n-neigh",
      },
    ]);

    const fakeEmbedder = {
      model: "fake-mini",
      dimensions: DIM,
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map(() => oneHot(0));
      },
      async embedQuery(_text: string): Promise<Float32Array> {
        return oneHot(0);
      },
    };

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: {
        ready: true,
        provider: "pgvector-local",
        model: "fake-mini",
        dimensions: DIM,
        embedder: fakeEmbedder,
      },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=marker",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const paths = body.map((r: { path: string }) => r.path);
    expect(paths).toContain("top.md");
    expect(paths).toContain("neighbour.md");
    expect(paths).not.toContain("loner.md");
    // Top should outrank the graph-only neighbour.
    expect(paths.indexOf("top.md")).toBeLessThan(paths.indexOf("neighbour.md"));
  });

  it("every fused result has a numeric score field populated", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    await dbHandle.db.insert(searchIndex).values({
      notePath: "only.md",
      userId: TEST_USER.id,
      title: "Only",
      content: "hello world",
      tags: "[]",
      modifiedAt: now,
    });
    await dbHandle.db.insert(noteEmbeddingChunk).values({
      userId: TEST_USER.id,
      notePath: "only.md",
      chunkIndex: 0,
      chunkText: "hello world chunk",
      embedding: Array.from(oneHot(0)),
      modifiedAt: now,
    });

    const fakeEmbedder = {
      model: "fake-mini",
      dimensions: DIM,
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map(() => oneHot(0));
      },
      async embedQuery(_text: string): Promise<Float32Array> {
        return oneHot(0);
      },
    };

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: {
        ready: true,
        provider: "pgvector-local",
        model: "fake-mini",
        dimensions: DIM,
        embedder: fakeEmbedder,
      },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=hello",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    for (const r of body) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThan(0);
    }
  });
});
