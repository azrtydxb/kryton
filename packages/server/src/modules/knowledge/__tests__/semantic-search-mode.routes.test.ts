import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { user } from "../../../db/schema/auth.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { noteEmbeddingChunk } from "../../../db/schema/embeddings.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

/**
 * Phase 5 — `?mode=` dispatch on GET /api/search.
 *
 * Uses a deterministic fake embedder so the suite stays fast — no model
 * loading. The fake produces one-hot 384-dim vectors keyed off the input
 * text, which is enough to prove that the cosine `<=>` operator + JOIN +
 * dedup pipeline returns the closer note at position 0.
 */

const DIM = 384;

function oneHot(idx: number): Float32Array {
  const v = new Float32Array(DIM);
  v[idx] = 1;
  return v;
}

const TEST_USER = { id: "u-mode", email: "mode@example.com", name: "M", role: "user" };

async function seedUser(handle: TestDbHandle): Promise<void> {
  await handle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
}

describe("knowledge / GET /api/search ?mode=", () => {
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

  it("mode=hybrid → 501 (Phase C)", async () => {
    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: { ready: true, provider: "pgvector-local", dimensions: DIM },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=anything&mode=hybrid",
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ message: "Hybrid search is Phase C" });
  });

  it("mode=semantic with embedderState.ready=false → 503", async () => {
    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: { ready: false, provider: "pgvector-local", dimensions: DIM },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=anything&mode=semantic",
    });
    expect(res.statusCode).toBe(503);
  });

  it("mode=semantic returns the closer note at position 0", async () => {
    // Seed two notes with known vectors.
    const now = new Date("2026-05-11T00:00:00Z");
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "near.md",
        userId: TEST_USER.id,
        title: "Near",
        content: "near content",
        tags: "[]",
        modifiedAt: now,
      },
      {
        notePath: "far.md",
        userId: TEST_USER.id,
        title: "Far",
        content: "far content",
        tags: "[]",
        modifiedAt: now,
      },
    ]);

    await dbHandle.db.insert(noteEmbeddingChunk).values([
      {
        userId: TEST_USER.id,
        notePath: "near.md",
        chunkIndex: 0,
        chunkText: "near chunk text that should appear in snippet",
        embedding: Array.from(oneHot(0)),
        modifiedAt: now,
      },
      {
        userId: TEST_USER.id,
        notePath: "far.md",
        chunkIndex: 0,
        chunkText: "far chunk text",
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
      url: "/api/search?q=anything&mode=semantic",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].path).toBe("near.md");
    expect(body[0].title).toBe("Near");
    expect(body[0].snippet).toContain("near chunk text");
    expect(body[0].score).toBeGreaterThan(body[1].score);
    expect(body[0].chunkIndex).toBe(0);
  });
});
