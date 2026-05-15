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
import { apiKey } from "../../../db/schema/auth.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildIdentityTestApp,
  cleanupIdentityTestUser,
  createIdentityTestDb,
  createIdentityTestUser,
  seedIdentityTestUser,
} from "./helpers.js";

const TEST_USER = createIdentityTestUser("apikeys");

describe("identity / api-keys routes", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    dbHandle = createIdentityTestDb();
    await seedIdentityTestUser(dbHandle, TEST_USER);
  });
  afterAll(async () => {
    await cleanupIdentityTestUser(dbHandle, TEST_USER.id);
    await dbHandle.close();
  });
  beforeEach(async () => {
    // Per-test scoped cleanup: only this suite's user's keys.
    await dbHandle.db.delete(apiKey).where(eq(apiKey.userId, TEST_USER.id));
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("POST /api/api-keys creates a key and returns the raw value once", async () => {
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
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
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "POST",
      url: "/api/api-keys",
      payload: { name: "", scope: "read-only" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/api-keys rejects API-key-based callers (session-only)", async () => {
    const app = await buildIdentityTestApp({
      user: TEST_USER,
      apiKey: { id: "k-existing", scope: "read-write" },
      dbHandle,
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
    const keyId = `k-list-${Math.floor(Math.random() * 1e9)}`;
    await dbHandle.db.insert(apiKey).values({
      id: keyId,
      userId: TEST_USER.id,
      name: "key-a",
      keyHash: "hash-a",
      keyPrefix: "kryton_aaaaaaaa",
      scope: "read-only",
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/api-keys" });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(keyId);
    expect(list[0].name).toBe("key-a");
  });

  it("DELETE /api/api-keys/:id revokes the key", async () => {
    const keyId = `k-del-${Math.floor(Math.random() * 1e9)}`;
    await dbHandle.db.insert(apiKey).values({
      id: keyId,
      userId: TEST_USER.id,
      name: "key-a",
      keyHash: "hash-a",
      keyPrefix: "kryton_aaaaaaaa",
      scope: "read-only",
    });
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: `/api/api-keys/${keyId}` });
    expect(res.statusCode).toBe(204);
    const remaining = await dbHandle.db
      .select()
      .from(apiKey)
      .where(eq(apiKey.id, keyId));
    expect(remaining).toHaveLength(0);
  });

  it("DELETE /api/api-keys/:id returns 404 for unknown key", async () => {
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: "/api/api-keys/missing-xyz" });
    expect(res.statusCode).toBe(404);
  });
});
