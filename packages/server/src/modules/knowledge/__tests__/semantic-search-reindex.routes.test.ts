import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
 * Phase 5 — POST /api/search/semantic/reindex.
 *
 * scope=self enqueues an upsert job for every SearchIndex row owned by the
 * caller; scope=all does the same across every user (admin only).
 */

const ALICE = { id: "u-alice", email: "alice@example.com", name: "Alice", role: "user" };
const ADMIN = { id: "u-admin", email: "admin@example.com", name: "Admin", role: "admin" };

async function seedUsers(handle: TestDbHandle): Promise<void> {
  await handle.db.insert(user).values([
    { id: ALICE.id, name: ALICE.name, email: ALICE.email },
    { id: ADMIN.id, name: ADMIN.name, email: ADMIN.email },
  ]);
}

describe("knowledge / POST /api/search/semantic/reindex", () => {
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
    await seedUsers(dbHandle);
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

    const jobs = await dbHandle.db.select().from(embedJob);
    expect(jobs).toHaveLength(0);
  });
});
