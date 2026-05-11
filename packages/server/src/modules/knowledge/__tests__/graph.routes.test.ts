import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { user } from "../../../db/schema/auth.js";
import { graphEdge, searchIndex } from "../../../db/schema/notes.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  createKnowledgeTestDb,
  resetKnowledgeTestDb,
} from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

async function seedGraph(dbHandle: TestDbHandle): Promise<void> {
  await dbHandle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
  await dbHandle.db.insert(searchIndex).values([
    {
      notePath: "A.md",
      userId: TEST_USER.id,
      title: "A",
      content: "",
      tags: "[]",
      modifiedAt: new Date(),
    },
    {
      notePath: "B.md",
      userId: TEST_USER.id,
      title: "B",
      content: "",
      tags: "[]",
      modifiedAt: new Date(),
    },
  ]);
  await dbHandle.db.insert(graphEdge).values({
    userId: TEST_USER.id,
    fromPath: "A.md",
    toPath: "B.md",
    fromNoteId: "A",
    toNoteId: "B",
  });
}

describe("knowledge / graph routes", () => {
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
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("GET /api/graph returns nodes and edges", async () => {
    await seedGraph(dbHandle);
    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/graph" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes.length).toBe(2);
    expect(body.edges.length).toBe(1);
    expect(body.edges[0]).toMatchObject({ fromNoteId: "A", toNoteId: "B" });
  });

  it("GET /api/graph returns 401 when unauthenticated", async () => {
    const app = await buildKnowledgeTestApp({ user: null, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/graph" });
    expect(res.statusCode).toBe(401);
  });
});
