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
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildKnowledgeTestApp,
  cleanupKnowledgeTestUser,
  createKnowledgeTestDb,
  createKnowledgeTestUser,
  seedKnowledgeTestUser,
} from "./helpers.js";

const TEST_USER = createKnowledgeTestUser("search");

describe("knowledge / search routes", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    dbHandle = createKnowledgeTestDb();
    await seedKnowledgeTestUser(dbHandle, TEST_USER);
  });

  afterAll(async () => {
    await cleanupKnowledgeTestUser(dbHandle, TEST_USER.id);
    await dbHandle.close();
  });

  beforeEach(async () => {
    // Per-test scoped reset: only this suite's user's index rows.
    await dbHandle.db
      .delete(searchIndex)
      .where(eq(searchIndex.userId, TEST_USER.id));
  });

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("GET /api/search returns FTS-matched rows from the user's index", async () => {
    await dbHandle.db.insert(searchIndex).values([
      {
        notePath: "Welcome.md",
        userId: TEST_USER.id,
        title: "Welcome",
        content: "Welcome to Kryton — a knowledge management tool.",
        tags: "[]",
        modifiedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        notePath: "Other.md",
        userId: TEST_USER.id,
        title: "Other",
        content: "Some unrelated content.",
        tags: "[]",
        modifiedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      dbHandle,
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=knowledge",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].path).toBe("Welcome.md");
    expect(body[0].title).toBe("Welcome");
  });

  it("GET /api/search uses English stemming (running matches run)", async () => {
    await dbHandle.db.insert(searchIndex).values({
      notePath: "Run.md",
      userId: TEST_USER.id,
      title: "Run",
      content: "I am running every morning.",
      tags: "[]",
      modifiedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const app = await buildKnowledgeTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/search?q=run" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].path).toBe("Run.md");
  });

  it("GET /api/search returns 401 when unauthenticated", async () => {
    const app = await buildKnowledgeTestApp({
      user: null,
      dbHandle,
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=anything",
    });
    expect(res.statusCode).toBe(401);
  });
});
