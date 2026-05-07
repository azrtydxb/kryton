import { describe, it, expect, afterEach } from "vitest";
import { buildKnowledgeTestApp } from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

function makePrismaStub() {
  const notes = [
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
  ];
  const edges = [
    {
      userId: TEST_USER.id,
      fromPath: "A.md",
      toPath: "B.md",
      fromNoteId: "A",
      toNoteId: "B",
    },
  ];
  return {
    searchIndex: {
      async findMany() {
        return notes;
      },
    },
    graphEdge: {
      async findMany() {
        return edges;
      },
    },
    noteShare: {
      async findMany() {
        return [];
      },
    },
  };
}

describe("knowledge / graph routes", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("GET /api/graph returns nodes and edges", async () => {
    const app = await buildKnowledgeTestApp({
      user: TEST_USER,
      prisma: makePrismaStub(),
    });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/graph" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes.length).toBe(2);
    expect(body.edges.length).toBe(1);
    expect(body.edges[0]).toMatchObject({ fromNoteId: "A", toNoteId: "B" });
  });

  it("GET /api/graph returns 401 when unauthenticated", async () => {
    const app = await buildKnowledgeTestApp({
      user: null,
      prisma: makePrismaStub(),
    });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/graph" });
    expect(res.statusCode).toBe(401);
  });
});
