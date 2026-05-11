import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { user } from "../../../db/schema/auth.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

/**
 * Phase 5 — GET /api/search/semantic/ready route.
 *
 * Verifies the readiness payload mirrors `app.embedderState`. `pendingJobs`
 * is sourced from the worker decorator when present; with the test app's
 * fake state the worker is a small stub so we can assert without spinning
 * up the real EmbedWorker.
 */

const TEST_USER = { id: "u-ready", email: "ready@example.com", name: "R", role: "user" };

async function seedUser(handle: TestDbHandle): Promise<void> {
  await handle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
}

describe("knowledge / GET /api/search/semantic/ready", () => {
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

  it("returns the off-mode shape when SEMANTIC_PROVIDER=off", async () => {
    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: {
        ready: false,
        provider: "off",
        dimensions: 384,
      },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search/semantic/ready",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ready: false,
      provider: "off",
      dimensions: 384,
      pendingJobs: 0,
    });
  });

  it("reports pendingJobs for the calling user from the worker decorator", async () => {
    // Seed a couple of jobs so the stub worker's pendingCount has something
    // to return; the stub itself just runs a count against EmbedJob.
    await dbHandle.db.insert(embedJob).values([
      { userId: TEST_USER.id, notePath: "a.md", op: "upsert", attempts: 0 },
      { userId: TEST_USER.id, notePath: "b.md", op: "upsert", attempts: 0 },
    ]);

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
      embedderState: {
        ready: true,
        provider: "pgvector-local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        worker: {
          async pendingCount(userId?: string) {
            const rows = userId
              ? await dbHandle.db
                  .select()
                  .from(embedJob)
                  .where(eq(embedJob.userId, userId))
              : await dbHandle.db.select().from(embedJob);
            return rows.length;
          },
        },
      },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search/semantic/ready",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ready: true,
      provider: "pgvector-local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
      pendingJobs: 2,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await buildKnowledgeTestApp({
      user: null,
      dbHandle,
      embedderState: { ready: false, provider: "off", dimensions: 384 },
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search/semantic/ready",
    });
    expect(res.statusCode).toBe(401);
  });
});
