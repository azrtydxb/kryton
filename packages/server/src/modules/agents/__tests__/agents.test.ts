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
import { agent, agentToken } from "../../../db/schema/agents.js";
import type { TestDbHandle } from "../../../test/db-fixture.js";
import {
  buildAgentsTestApp,
  cleanupAgentsTestUser,
  createAgentsTestDb,
  createAgentsTestUser,
  seedAgentsTestUser,
} from "./helpers.js";

const TEST_USER = createAgentsTestUser("owner");
const OTHER_USER = createAgentsTestUser("other");

// Per-suite unique resource ids. With fileParallelism: true the agents
// table is shared across parallel suites, so the previous "ag1" / "tid1"
// constants would collide.
const SUITE_SUFFIX = `${Math.floor(Math.random() * 1e9)}-${process.pid}`;
const AGENT_ID = `ag1-${SUITE_SUFFIX}`;
const TOKEN_ID = `tid1-${SUITE_SUFFIX}`;

describe("agents routes", () => {
  let dbHandle: TestDbHandle;
  let close: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    dbHandle = createAgentsTestDb();
    await seedAgentsTestUser(dbHandle, TEST_USER);
    await seedAgentsTestUser(dbHandle, OTHER_USER);
  });
  afterAll(async () => {
    await cleanupAgentsTestUser(dbHandle, TEST_USER.id);
    await cleanupAgentsTestUser(dbHandle, OTHER_USER.id);
    await dbHandle.close();
  });
  beforeEach(async () => {
    // Per-test cleanup: delete only this suite's user's agents (cascade
    // removes their tokens). Don't touch other suites' rows.
    await dbHandle.db.delete(agent).where(eq(agent.ownerUserId, TEST_USER.id));
    await dbHandle.db.delete(agent).where(eq(agent.ownerUserId, OTHER_USER.id));
  });
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  describe("POST /api/agents", () => {
    it("creates an agent and returns 201", async () => {
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
      expect(body.ownerUserId).toBe(TEST_USER.id);
      expect(body.policyText).toBeNull();

      const rows = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, body.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].ownerUserId).toBe(TEST_USER.id);
    });

    it("returns 400 for missing required fields", async () => {
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
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: TEST_USER.id,
        name: "bot",
        label: "Bot",
      });

      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "GET", url: "/api/agents" });
      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(1);
      expect(res.json().agents[0].id).toBe(AGENT_ID);
    });
  });

  describe("DELETE /api/agents/:id", () => {
    it("deletes owned agent and returns 204", async () => {
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: TEST_USER.id,
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "DELETE", url: `/api/agents/${AGENT_ID}` });
      expect(res.statusCode).toBe(204);
      const remaining = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, AGENT_ID));
      expect(remaining).toHaveLength(0);
    });

    it("returns 404 for unowned agent", async () => {
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: OTHER_USER.id,
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({ method: "DELETE", url: `/api/agents/${AGENT_ID}` });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when agent missing", async () => {
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();
      const res = await app.inject({ method: "DELETE", url: `/api/agents/missing-${SUITE_SUFFIX}` });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/agents/:id/policies", () => {
    it("sets policy and returns 204", async () => {
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: TEST_USER.id,
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: `/api/agents/${AGENT_ID}/policies`,
        payload: { policyText: "permit(principal, action, resource);" },
      });
      expect(res.statusCode).toBe(204);
      const row = await dbHandle.db
        .select()
        .from(agent)
        .where(eq(agent.id, AGENT_ID));
      expect(row[0].policyText).toBe("permit(principal, action, resource);");
    });
  });

  describe("POST /api/agents/:id/tokens", () => {
    it("mints a token and returns 201", async () => {
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: TEST_USER.id,
        name: "bot",
        label: "Bot",
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: `/api/agents/${AGENT_ID}/tokens`,
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
      expect(stored[0].agentId).toBe(AGENT_ID);
    });
  });

  describe("POST /api/agents/tokens/:tokenId/revoke", () => {
    it("revokes a token and returns 204", async () => {
      await dbHandle.db.insert(agent).values({
        id: AGENT_ID,
        ownerUserId: TEST_USER.id,
        name: "bot",
        label: "Bot",
      });
      await dbHandle.db.insert(agentToken).values({
        id: TOKEN_ID,
        agentId: AGENT_ID,
        tokenHash: "h",
        expiresAt: new Date("2099-01-01"),
      });
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();

      const res = await app.inject({
        method: "POST",
        url: `/api/agents/tokens/${TOKEN_ID}/revoke`,
      });
      expect(res.statusCode).toBe(204);
      const row = await dbHandle.db
        .select()
        .from(agentToken)
        .where(eq(agentToken.id, TOKEN_ID));
      expect(row[0].revokedAt).toBeInstanceOf(Date);
    });

    it("returns 404 for missing token", async () => {
      const app = await buildAgentsTestApp({ user: TEST_USER, dbHandle });
      close = () => app.close();
      const res = await app.inject({
        method: "POST",
        url: `/api/agents/tokens/unknown-${SUITE_SUFFIX}/revoke`,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
