import { describe, it, expect, afterEach } from "vitest";
import { buildIdentityTestApp } from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scope: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function makePrisma(initial: ApiKeyRow[] = []) {
  const rows: ApiKeyRow[] = [...initial];
  let seq = 0;
  return {
    apiKey: {
      async count({ where }: { where: { userId: string } }) {
        return rows.filter((r) => r.userId === where.userId).length;
      },
      async create({ data }: { data: Omit<ApiKeyRow, "id" | "lastUsedAt" | "createdAt"> }) {
        const row: ApiKeyRow = {
          id: `k-${++seq}`,
          lastUsedAt: null,
          createdAt: new Date(),
          ...data,
          expiresAt: data.expiresAt ?? null,
        };
        rows.push(row);
        return row;
      },
      async findMany({ where }: { where: { userId: string } }) {
        return rows
          .filter((r) => r.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async findUnique({ where }: { where: { id?: string; keyHash?: string } }) {
        return (
          rows.find((r) => (where.id && r.id === where.id) || (where.keyHash && r.keyHash === where.keyHash)) ??
          null
        );
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error("not found");
        const [removed] = rows.splice(idx, 1);
        return removed;
      },
    },
    _rows: rows,
  };
}

describe("identity / api-keys routes", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("POST /api/api-keys creates a key and returns the raw value once", async () => {
    const prisma = makePrisma();
    const app = await buildIdentityTestApp({ user: TEST_USER, prisma });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/api-keys",
      payload: { name: "CI key", scope: "read-only" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("CI key");
    expect(body.scope).toBe("read-only");
    expect(body.key).toMatch(/^kryton_[0-9a-f]+$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 7 + 8));
  });

  // BLOCKED: see users.routes.test.ts — validation-failure path crashes
  // inside fastify-type-provider-zod 4.0.2 against Zod 4.
  it.skip("POST /api/api-keys validates body", async () => {
    const prisma = makePrisma();
    const app = await buildIdentityTestApp({ user: TEST_USER, prisma });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/api-keys",
      payload: { name: "", scope: "read-only" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/api-keys rejects API-key-based callers (session-only)", async () => {
    const prisma = makePrisma();
    const app = await buildIdentityTestApp({
      user: TEST_USER,
      apiKey: { id: "k-existing", scope: "read-write" },
      prisma,
    });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/api-keys",
      payload: { name: "second", scope: "read-only" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/api-keys lists user's keys", async () => {
    const prisma = makePrisma([
      {
        id: "k-1",
        userId: TEST_USER.id,
        name: "key-a",
        keyHash: "hash-a",
        keyPrefix: "kryton_aaaaaaaa",
        scope: "read-only",
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);
    const app = await buildIdentityTestApp({ user: TEST_USER, prisma });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/api-keys" });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("k-1");
    expect(list[0].name).toBe("key-a");
  });

  it("DELETE /api/api-keys/:id revokes the key", async () => {
    const prisma = makePrisma([
      {
        id: "k-1",
        userId: TEST_USER.id,
        name: "key-a",
        keyHash: "hash-a",
        keyPrefix: "kryton_aaaaaaaa",
        scope: "read-only",
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      },
    ]);
    const app = await buildIdentityTestApp({ user: TEST_USER, prisma });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: "/api/api-keys/k-1" });
    expect(res.statusCode).toBe(204);
    expect(prisma._rows).toHaveLength(0);
  });

  it("DELETE /api/api-keys/:id returns 404 for unknown key", async () => {
    const prisma = makePrisma();
    const app = await buildIdentityTestApp({ user: TEST_USER, prisma });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: "/api/api-keys/missing" });
    expect(res.statusCode).toBe(404);
  });
});
