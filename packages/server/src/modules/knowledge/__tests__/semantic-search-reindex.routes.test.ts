import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq } from "drizzle-orm";
import { searchIndex } from "../../../db/schema/notes.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  cleanupKnowledgeTestUser,
  createKnowledgeTestDb,
  createKnowledgeTestUser,
  seedKnowledgeTestUser,
} from "./helpers.js";

/**
 * Phase 5 — POST /api/search/semantic/reindex.
 *
 * scope=self enqueues an upsert job for every SearchIndex row owned by the
 * caller; scope=all does the same across every user (admin only). Tests run
 * with per-suite unique userIds so the scope=all assertion is bounded to
 * this suite's rows (filtered by ALICE/ADMIN ids).
 */

const ALICE = createKnowledgeTestUser("alice");
const ADMIN = createKnowledgeTestUser("admin", "admin");

describe("knowledge / POST /api/search/semantic/reindex", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    dbHandle = createKnowledgeTestDb();
    await seedKnowledgeTestUser(dbHandle, ALICE);
    await seedKnowledgeTestUser(dbHandle, ADMIN);
  });

  afterAll(async () => {
    await cleanupKnowledgeTestUser(dbHandle, ALICE.id);
    await cleanupKnowledgeTestUser(dbHandle, ADMIN.id);
    await dbHandle.close();
  });

  beforeEach(async () => {
    await dbHandle.db.delete(embedJob).where(eq(embedJob.userId, ALICE.id));
    await dbHandle.db.delete(embedJob).where(eq(embedJob.userId, ADMIN.id));
    await dbHandle.db
      .delete(searchIndex)
      .where(eq(searchIndex.userId, ALICE.id));
    await dbHandle.db
      .delete(searchIndex)
      .where(eq(searchIndex.userId, ADMIN.id));
  });

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("scope=self enqueues an upsert job for every SearchIndex row of the caller", async () => {
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "a.md",
        userId: ALICE.id,
        title: "A",
        content: "alpha",
        tags: "[]",
        modifiedAt: new Date(),
      },
      {
        notePath: "b.md",
        userId: ALICE.id,
        title: "B",
        content: "beta",
        tags: "[]",
        modifiedAt: new Date(),
      },
    ]);

    const app = await buildKnowledgeTestApp({
      user: ALICE,
      dbHandle,
      embedderProvider: "pgvector-local",
    });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/search/semantic/reindex",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enqueued: 2 });

    const jobs = await dbHandle.db
      .select()
      .from(embedJob)
      .where(eq(embedJob.userId, ALICE.id));
    expect(jobs).toHaveLength(2);
    const paths = jobs.map((j) => j.notePath).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
    for (const j of jobs) {
      expect(j.op).toBe("upsert");
      expect(j.attempts).toBe(0);
    }
  });

  it("scope=all from a non-admin returns 403", async () => {
    const app = await buildKnowledgeTestApp({
      user: ALICE,
      dbHandle,
      embedderProvider: "pgvector-local",
    });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/search/semantic/reindex?scope=all",
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns { enqueued: 0 } when the user has no indexed notes", async () => {
    const app = await buildKnowledgeTestApp({
      user: ALICE,
      dbHandle,
      embedderProvider: "pgvector-local",
    });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/search/semantic/reindex",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enqueued: 0 });

    // Scope to ALICE — other parallel suites may have their own jobs.
    const jobs = await dbHandle.db
      .select()
      .from(embedJob)
      .where(eq(embedJob.userId, ALICE.id));
    expect(jobs).toHaveLength(0);
  });
});
