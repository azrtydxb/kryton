import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { user } from "../../../db/schema/auth.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

/**
 * GET/PUT /api/search/weights — per-user fusion weights backed by the
 * Settings table (key: "fusion_weights").
 */

const TEST_USER = {
  id: "u-fw",
  email: "fw@example.com",
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

describe("knowledge / /api/search/weights", () => {
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

  it("GET returns defaults 0.4/0.4/0.2 when user has no setting", async () => {
    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/search/weights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lex).toBeCloseTo(0.4, 5);
    expect(body.sem).toBeCloseTo(0.4, 5);
    expect(body.graph).toBeCloseTo(0.2, 5);
  });

  it("PUT normalises unnormalised weights so sum=1", async () => {
    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "PUT",
      url: "/api/search/weights",
      payload: { lex: 1, sem: 1, graph: 0.5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 1/2.5=0.4 ; 0.5/2.5=0.2
    expect(body.lex).toBeCloseTo(0.4, 5);
    expect(body.sem).toBeCloseTo(0.4, 5);
    expect(body.graph).toBeCloseTo(0.2, 5);
    expect(body.lex + body.sem + body.graph).toBeCloseTo(1, 5);
  });

  it("GET after PUT returns the stored normalised weights", async () => {
    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    await app.inject({
      method: "PUT",
      url: "/api/search/weights",
      payload: { lex: 0.6, sem: 0.3, graph: 0.1 },
    });

    const res = await app.inject({ method: "GET", url: "/api/search/weights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lex).toBeCloseTo(0.6, 5);
    expect(body.sem).toBeCloseTo(0.3, 5);
    expect(body.graph).toBeCloseTo(0.1, 5);
  });

  it("PUT with all zeros falls back to defaults", async () => {
    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "PUT",
      url: "/api/search/weights",
      payload: { lex: 0, sem: 0, graph: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lex).toBeCloseTo(0.4, 5);
    expect(body.sem).toBeCloseTo(0.4, 5);
    expect(body.graph).toBeCloseTo(0.2, 5);
  });
});
