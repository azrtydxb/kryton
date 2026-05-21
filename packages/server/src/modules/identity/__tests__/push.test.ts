import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pushDevices } from "../../../db/schema/push.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildIdentityTestApp,
  cleanupIdentityTestUser,
  createIdentityTestDb,
  createIdentityTestUser,
  seedIdentityTestUser,
} from "./helpers.js";

const TEST_USER = createIdentityTestUser("push");

describe("identity / push routes", () => {
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
    await dbHandle.db.delete(pushDevices).where(eq(pushDevices.userId, TEST_USER.id));
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  describe("POST /api/push/register", () => {
    it("registers a new device for the authenticated user", async () => {
      const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "ios", token: "apns-token-aaaa" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({ id: expect.any(String), platform: "ios" });

      const rows = await dbHandle.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.userId, TEST_USER.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].token).toBe("apns-token-aaaa");
    });

    it("upserts when the same (platform, token) is registered again", async () => {
      const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "ios", token: "apns-token-bbbb" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "ios", token: "apns-token-bbbb" },
      });
      expect(res.statusCode).toBe(200);

      const rows = await dbHandle.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.userId, TEST_USER.id));
      expect(rows).toHaveLength(1);
    });

    it("rejects unauthenticated requests with 401", async () => {
      const app = await buildIdentityTestApp({ user: null, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "ios", token: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects invalid platform with 400", async () => {
      const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "windows", token: "x" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/push/register/:id", () => {
    it("deletes an owned device and returns 204", async () => {
      const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const createRes = await app.inject({
        method: "POST",
        url: "/api/push/register",
        payload: { platform: "android", token: "fcm-token-cccc" },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json();

      const delRes = await app.inject({
        method: "DELETE",
        url: `/api/push/register/${id}`,
      });
      expect(delRes.statusCode).toBe(204);

      const rows = await dbHandle.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.userId, TEST_USER.id));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 for an unknown device id", async () => {
      const app = await buildIdentityTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "DELETE",
        url: "/api/push/register/nonexistent-id",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
