import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey, user } from "../../../db/schema/auth.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildIdentityTestApp,
  createIdentityTestDb,
  resetIdentityTestDb,
} from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

async function seedUser(dbHandle: TestDbHandle): Promise<void> {
  await dbHandle.db.insert(user).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
  });
}

describe("identity / api-keys routes", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(() => {
    dbHandle = createIdentityTestDb();
  });
  afterAll(async () => {
    await dbHandle.close();
  });
  beforeEach(async () => {
    await resetIdentityTestDb(dbHandle);
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("POST /api/api-keys creates a key and returns the raw value once", async () => {
    await seedUser(dbHandle);
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
    await seedUser(dbHandle);
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
    await seedUser(dbHandle);
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
    await seedUser(dbHandle);
    await dbHandle.db.insert(apiKey).values({
      id: "k-1",
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
    expect(list[0].id).toBe("k-1");
    expect(list[0].name).toBe("key-a");
  });

  it("DELETE /api/api-keys/:id revokes the key", async () => {
    await seedUser(dbHandle);
    await dbHandle.db.insert(apiKey).values({
      id: "k-1",
      userId: TEST_USER.id,
      name: "key-a",
      keyHash: "hash-a",
      keyPrefix: "kryton_aaaaaaaa",
      scope: "read-only",
    });
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: "/api/api-keys/k-1" });
    expect(res.statusCode).toBe(204);
    const remaining = await dbHandle.db
      .select()
      .from(apiKey)
      .where(eq(apiKey.id, "k-1"));
    expect(remaining).toHaveLength(0);
  });

  it("DELETE /api/api-keys/:id returns 404 for unknown key", async () => {
    await seedUser(dbHandle);
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "DELETE", url: "/api/api-keys/missing" });
    expect(res.statusCode).toBe(404);
  });
});
