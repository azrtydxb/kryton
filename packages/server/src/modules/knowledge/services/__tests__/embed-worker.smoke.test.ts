/**
 * Smoke test for the EmbedWorker (Phase 3).
 *
 * Uses a fake embedder so we don't load the real 23 MB MiniLM model. The DB
 * is the real testcontainers Postgres; this proves the full enqueue → drain
 * → write → delete-job round trip works against actual SQL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FastifyBaseLogger } from "fastify";

import { user } from "../../../../db/schema/auth.js";
import { searchIndex } from "../../../../db/schema/notes.js";
import { embedJob, noteEmbeddingChunk } from "../../../../db/schema/embeddings.js";
import { createTestDb, type TestDbHandle } from "../../../../test/db-fixture.js";
import { EmbedWorker } from "../embed-worker.js";
import type { Embedder } from "../embedder.js";

const DIMS = 384;

function makeFakeEmbedder(): Embedder {
  return {
    model: "fake-model",
    dimensions: DIMS,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => new Float32Array(DIMS).fill(0.1));
    },
    async embedQuery(): Promise<Float32Array> {
      return new Float32Array(DIMS).fill(0.1);
    },
  };
}

const silentLog = {
  // Cast through unknown to satisfy the structural FastifyBaseLogger type
  // without dragging in pino. The worker only uses .info/.warn/.error.
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child() { return silentLog; },
  level: "silent",
} as unknown as FastifyBaseLogger;

// Per-suite unique userId so this file is safe under fileParallelism:
// true. Satisfies SAFE_USER_ID_REGEX in
// services/user-notes-dir.service.ts (/^[a-zA-Z0-9_-]{8,64}$/).
const TEST_USER_ID = `u-embed-${Math.floor(Math.random() * 1e9)}-${process.pid}`;

describe("EmbedWorker (smoke)", () => {
  let handle: TestDbHandle;
  let notesDir: string;

  beforeAll(async () => {
    handle = createTestDb();
    notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "embed-worker-smoke-"));
    await fs.mkdir(path.join(notesDir, TEST_USER_ID), { recursive: true });
    // Seed the suite-scoped user once. Per-test cleanup wipes only
    // this user's rows; the user itself lives for the whole suite.
    await handle.db
      .insert(user)
      .values({
        id: TEST_USER_ID,
        email: `embed-worker-${process.pid}@test.local`,
        name: "Embed Worker Test",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Scoped cleanup: only delete rows owned by this suite's user.
    // Cascade from User clears SearchIndex / EmbedJob /
    // NoteEmbeddingChunk by FK.
    await handle.db.delete(user).where(eq(user.id, TEST_USER_ID));
    await handle.close();
    await fs.rm(notesDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Targeted reset of this user's child rows between tests. We
    // avoid TRUNCATE because parallel suites share the same DB.
    await handle.db
      .delete(noteEmbeddingChunk)
      .where(eq(noteEmbeddingChunk.userId, TEST_USER_ID));
    await handle.db.delete(embedJob).where(eq(embedJob.userId, TEST_USER_ID));
    await handle.db.delete(searchIndex).where(eq(searchIndex.userId, TEST_USER_ID));
  });

  it("processes an upsert job: writes chunks and removes the job row", async () => {
    const notePath = "hello.md";
    const fullPath = path.join(notesDir, TEST_USER_ID, notePath);
    await fs.writeFile(fullPath, "This is the body of hello.md.\n\nA second paragraph.", "utf-8");

    await handle.db.insert(searchIndex).values({
      notePath,
      userId: TEST_USER_ID,
      title: "Hello",
      content: "ignored for embedding",
      tags: "",
      modifiedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await handle.db.insert(embedJob).values({
      userId: TEST_USER_ID,
      notePath,
      op: "upsert",
    });

    const worker = new EmbedWorker({
      db: handle.db,
      log: silentLog,
      embedder: makeFakeEmbedder(),
      notesDir,
    });

    // Drive one pop+process cycle manually — no polling loop required.
    const job = await (worker as unknown as {
      popOldestJob: () => Promise<unknown>;
    }).popOldestJob();
    expect(job).not.toBeNull();
    await (worker as unknown as {
      processJob: (j: unknown) => Promise<void>;
    }).processJob(job);

    const chunks = await handle.db
      .select()
      .from(noteEmbeddingChunk)
      .where(
        and(
          eq(noteEmbeddingChunk.userId, TEST_USER_ID),
          eq(noteEmbeddingChunk.notePath, notePath),
        ),
      );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.chunkIndex).toBe(0);

    const remaining = await handle.db
      .select()
      .from(embedJob)
      .where(eq(embedJob.userId, TEST_USER_ID));
    expect(remaining).toHaveLength(0);
  });

  it("treats ENOENT (missing file) as a delete: clears chunks + removes job", async () => {
    const notePath = "ghost.md";

    // Seed pre-existing chunks for this note (as if a prior embed had run).
    await handle.db.insert(searchIndex).values({
      notePath,
      userId: TEST_USER_ID,
      title: "Ghost",
      content: "irrelevant",
      tags: "",
      modifiedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await handle.db.insert(noteEmbeddingChunk).values({
      userId: TEST_USER_ID,
      notePath,
      chunkIndex: 0,
      chunkText: "stale",
      embedding: Array.from(new Float32Array(DIMS).fill(0.5)),
      modifiedAt: new Date("2026-01-01T00:00:00Z"),
    });

    // File does NOT exist on disk — worker should treat as delete.
    await handle.db.insert(embedJob).values({
      userId: TEST_USER_ID,
      notePath,
      op: "upsert",
    });

    const worker = new EmbedWorker({
      db: handle.db,
      log: silentLog,
      embedder: makeFakeEmbedder(),
      notesDir,
    });

    const job = await (worker as unknown as {
      popOldestJob: () => Promise<unknown>;
    }).popOldestJob();
    await (worker as unknown as {
      processJob: (j: unknown) => Promise<void>;
    }).processJob(job);

    const chunks = await handle.db
      .select()
      .from(noteEmbeddingChunk)
      .where(
        and(
          eq(noteEmbeddingChunk.userId, TEST_USER_ID),
          eq(noteEmbeddingChunk.notePath, notePath),
        ),
      );
    expect(chunks).toHaveLength(0);

    const remaining = await handle.db
      .select()
      .from(embedJob)
      .where(eq(embedJob.userId, TEST_USER_ID));
    expect(remaining).toHaveLength(0);
  });
});
