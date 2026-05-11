import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { user } from "../../../db/schema/auth.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

/**
 * Phase 4 — verify SearchService mutations enqueue rows in `EmbedJob`.
 *
 * The tests run against a real Postgres (testcontainers) but never load the
 * embedder model: we decorate `app.embedderState` with provider
 * "pgvector-local" + ready=false so `enqueueEmbedJob` writes jobs but no
 * worker is active to drain them.
 */

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

async function seedUser(dbHandle: TestDbHandle): Promise<void> {
  await dbHandle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
}

describe("SearchService → EmbedJob enqueue", () => {
  let dbHandle: TestDbHandle;
  let app: FastifyInstance | null = null;

  beforeAll(() => {
    dbHandle = createKnowledgeTestDb();
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  beforeEach(async () => {
    await resetKnowledgeTestDb(dbHandle);
    await seedUser(dbHandle);
    app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderProvider: "pgvector-local",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("indexNote enqueues an upsert job alongside the SearchIndex write", async () => {
    await app!.knowledge.indexNote("test/foo.md", "# Foo\n\nbody", TEST_USER.id);

    const idx = await dbHandle.db.select().from(searchIndex);
    expect(idx).toHaveLength(1);
    expect(idx[0].notePath).toBe("test/foo.md");

    const jobs = await dbHandle.db.select().from(embedJob);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      userId: TEST_USER.id,
      notePath: "test/foo.md",
      op: "upsert",
      attempts: 0,
      error: null,
    });
  });

  it("removeFromIndex enqueues a delete job", async () => {
    await app!.knowledge.indexNote("test/foo.md", "# Foo\n\nbody", TEST_USER.id);
    // Clear the upsert job so we can observe just the delete.
    await dbHandle.db.delete(embedJob);

    await app!.knowledge.removeFromIndex("test/foo.md", TEST_USER.id);

    const idx = await dbHandle.db.select().from(searchIndex);
    expect(idx).toHaveLength(0);

    const jobs = await dbHandle.db.select().from(embedJob);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      userId: TEST_USER.id,
      notePath: "test/foo.md",
      op: "delete",
    });
  });

  it("renameInIndex enqueues a delete + an upsert", async () => {
    await app!.knowledge.indexNote("test/old.md", "# Old\n\nbody", TEST_USER.id);
    await dbHandle.db.delete(embedJob);

    await app!.knowledge.renameInIndex("test/old.md", "test/new.md", TEST_USER.id);

    const idx = await dbHandle.db.select().from(searchIndex);
    expect(idx).toHaveLength(1);
    expect(idx[0].notePath).toBe("test/new.md");

    const jobs = await dbHandle.db
      .select()
      .from(embedJob)
      .orderBy(embedJob.notePath);
    expect(jobs).toHaveLength(2);
    const byPath = Object.fromEntries(jobs.map((j) => [j.notePath, j]));
    expect(byPath["test/old.md"]?.op).toBe("delete");
    expect(byPath["test/new.md"]?.op).toBe("upsert");
  });

  it("repeat indexNote calls coalesce into one job via ON CONFLICT", async () => {
    await app!.knowledge.indexNote("test/foo.md", "# v1", TEST_USER.id);
    const firstJob = await dbHandle.db
      .select()
      .from(embedJob)
      .where(
        and(eq(embedJob.userId, TEST_USER.id), eq(embedJob.notePath, "test/foo.md")),
      );
    expect(firstJob).toHaveLength(1);
    const firstEnqueuedAt = firstJob[0].enqueuedAt;

    // Bump enqueuedAt: a tiny delay so NOW() advances detectably.
    await new Promise((r) => setTimeout(r, 25));
    await app!.knowledge.indexNote("test/foo.md", "# v2", TEST_USER.id);
    await app!.knowledge.indexNote("test/foo.md", "# v3", TEST_USER.id);

    const jobs = await dbHandle.db.select().from(embedJob);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].op).toBe("upsert");
    expect(jobs[0].attempts).toBe(0);
    expect(jobs[0].enqueuedAt.getTime()).toBeGreaterThan(firstEnqueuedAt.getTime());
  });
});

describe("SearchService → EmbedJob enqueue (provider=off)", () => {
  let dbHandle: TestDbHandle;
  let app: FastifyInstance | null = null;

  beforeAll(() => {
    dbHandle = createKnowledgeTestDb();
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  beforeEach(async () => {
    await resetKnowledgeTestDb(dbHandle);
    await seedUser(dbHandle);
    app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderProvider: "off",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("does NOT enqueue when embedderState.provider is 'off'", async () => {
    await app!.knowledge.indexNote("test/foo.md", "# Foo", TEST_USER.id);

    const idx = await dbHandle.db.select().from(searchIndex);
    expect(idx).toHaveLength(1);

    const jobs = await dbHandle.db.select().from(embedJob);
    expect(jobs).toHaveLength(0);
  });
});
