import { describe, it, expect, afterEach } from "vitest";
import { buildKnowledgeTestApp } from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

interface IndexRow {
  notePath: string;
  userId: string;
  title: string;
  content: string;
  tags: string;
  modifiedAt: Date;
}

function makePrismaStub(rows: IndexRow[]) {
  return {
    searchIndex: {
      async findMany({ where }: { where?: { userId?: string; notePath?: { in?: string[] } } } = {}) {
        return rows.filter((r) => {
          if (where?.userId && r.userId !== where.userId) return false;
          if (where?.notePath?.in && !where.notePath.in.includes(r.notePath)) return false;
          return true;
        });
      },
    },
    noteShare: {
      async findMany() {
        return [];
      },
    },
  };
}

describe("knowledge / search routes", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("GET /api/search returns results from the user's index", async () => {
    const rows: IndexRow[] = [
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
    ];

    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      prisma: makePrismaStub(rows),
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=knowledge",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].path).toBe("Welcome.md");
    expect(body[0].title).toBe("Welcome");
  });

  it("GET /api/search returns 401 when unauthenticated", async () => {
    const app = await buildKnowledgeTestApp({
      user: null,
      prisma: makePrismaStub([]),
    });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=anything",
    });
    expect(res.statusCode).toBe(401);
  });
});
