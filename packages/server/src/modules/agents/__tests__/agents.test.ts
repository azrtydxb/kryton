import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { user } from "../../../db/schema/auth.js";
import { agent, agentToken } from "../../../db/schema/agents.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildAgentsTestApp,
  createAgentsTestDb,
  resetAgentsTestDb,
} from "./helpers.js";

const TEST_USER = {
  id: "u-test",
  email: "test@example.com",
  name: "Test",
  role: "user",
};

async function seedUser(dbHandle: TestDbHandle, id = TEST_USER.id): Promise<void> {
  await dbHandle.db.insert(user).values({
    id,
    name: id === TEST_USER.id ? TEST_USER.name : id,
    email: id === TEST_USER.id ? TEST_USER.email : `${id}@example.com`,
  });
}

describe("agents routes", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(() => {
    dbHandle = createAgentsTestDb();
  });
  afterAll(async () => {
    await dbHandle.close();
  });
  beforeEach(async () => {
    await resetAgentsTestDb(dbHandle);
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  describe("POST /api/agents", () => {
    it("creates an agent and returns 201", async () => {
      await seedUser(dbHandle);
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude", label: "Claude" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("claude");
      expect(body.label).toBe("Claude");
      expect(body.ownerUserId).toBe("u-test");
      expect(body.policyText).toBeNull();

      const rows = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, body.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].ownerUserId).toBe("u-test");
    });

    it("returns 400 for missing required fields", async () => {
      await seedUser(dbHandle);
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      const app = await buildAgentsTestApp({ user: null, dbHandle });
      close = () => app.close();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude", label: "Claude" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/agents", () => {
    it("returns the agent list", async () => {
      await seedUser(dbHandle);
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
      });

      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "GET", url: "/api/agents" });
      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(1);
      expect(res.json().agents[0].id).toBe("ag1");
    });
  });

  describe("DELETE /api/agents/:id", () => {
    it("deletes owned agent and returns 204", async () => {
      await seedUser(dbHandle);
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "DELETE", url: "/api/agents/ag1" });
      expect(res.statusCode).toBe(204);
      const remaining = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, "ag1"));
      expect(remaining).toHaveLength(0);
    });

    it("returns 404 for unowned agent", async () => {
      await seedUser(dbHandle);
      await seedUser(dbHandle, "other");
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "other",
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "DELETE", url: "/api/agents/ag1" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when agent missing", async () => {
      await seedUser(dbHandle);
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();
      const res = await app.inject({ method: "DELETE", url: "/api/agents/missing" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/agents/:id/policies", () => {
    it("sets policy and returns 204", async () => {
      await seedUser(dbHandle);
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/ag1/policies",
        payload: { policyText: "permit(principal, action, resource);" },
      });
      expect(res.statusCode).toBe(204);
      const row = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, "ag1"));
      expect(row[0].policyText).toBe("permit(principal, action, resource);");
    });
  });

  describe("POST /api/agents/:id/tokens", () => {
    it("mints a token and returns 201", async () => {
      await seedUser(dbHandle);
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/ag1/tokens",
        payload: { expiresInSeconds: 3600 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(typeof body.tokenId).toBe("string");
      expect(typeof body.token).toBe("string");

      const stored = await dbHandle.db
        .select()
        .from(agentToken)
        .where(eq(agentToken.id, body.tokenId));
      expect(stored).toHaveLength(1);
      expect(stored[0].agentId).toBe("ag1");
    });
  });

  describe("POST /api/agents/tokens/:tokenId/revoke", () => {
    it("revokes a token and returns 204", async () => {
      await seedUser(dbHandle);
      await dbHandle.db.insert(agent).values({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
      });
      await dbHandle.db.insert(agentToken).values({
        id: "tid1",
        agentId: "ag1",
        tokenHash: "h",
        expiresAt: new Date("2099-01-01"),
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/tokens/tid1/revoke",
      });
      expect(res.statusCode).toBe(204);
      const row = await dbHandle.db
        .select()
        .from(agentToken)
        .where(eq(agentToken.id, "tid1"));
      expect(row[0].revokedAt).toBeInstanceOf(Date);
    });

    it("returns 404 for missing token", async () => {
      await seedUser(dbHandle);
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/tokens/unknown/revoke",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
