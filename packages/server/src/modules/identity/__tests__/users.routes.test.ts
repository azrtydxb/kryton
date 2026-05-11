import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { user } from "../../../db/schema/auth.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildIdentityTestApp,
  createIdentityTestDb,
  resetIdentityTestDb,
} from "./helpers.js";

const TEST_USER = { id: "u-1", email: "alice@example.com", name: "Alice", role: "user" };

describe("identity / users routes", () => {
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

  it("GET /api/users/search returns the user when found", async () => {
    await dbHandle.db.insert(user).values({
      id: "u-bob",
      name: "Bob",
      email: "bob@example.com",
    });

    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/search?email=bob@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "u-bob", name: "Bob", email: "bob@example.com" });
  });

  it("GET /api/users/search returns 404 when not found", async () => {
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/search?email=nope@example.com",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  // BLOCKED: fastify-type-provider-zod 4.0.2 calls error.errors, but Zod 4
  // exposes .issues — validation-failure responses currently hit the 500 path.
  // Re-enable once the foundation team upgrades / patches the type provider.
  it.skip("GET /api/users/search returns 400 when email is missing", async () => {
    const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
    close = () => app.close();

    const res = await app.inject({ method: "GET", url: "/api/users/search" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/users/search returns 401 when unauthenticated", async () => {
    const app = await buildIdentityTestApp({ user: null, dbHandle });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/search?email=x@example.com",
    });
    expect(res.statusCode).toBe(401);
  });
});
