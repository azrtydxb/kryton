import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAgentsTestApp } from "./helpers.js";

const TEST_USER = {
  id: "u-test",
  email: "test@example.com",
  name: "Test",
  role: "user",
};

interface PrismaStub {
  agent: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  agentToken: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
}

function makePrismaStub(): PrismaStub {
  return {
    agent: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    agentToken: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("agents routes", () => {
  let app: FastifyInstance;
  let prisma: PrismaStub;

  beforeEach(async () => {
    prisma = makePrismaStub();
    app = await buildAgentsTestApp({ user: TEST_USER, prisma });
  });

  describe("POST /api/agents", () => {
    it("creates an agent and returns 201", async () => {
      prisma.agent.create.mockResolvedValue({
        id: "ag1",
        ownerUserId: "u-test",
        name: "claude",
        label: "Claude",
        policyText: null,
        createdAt: new Date("2026-01-01"),
        lastSeenAt: null,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude", label: "Claude" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe("ag1");
      expect(prisma.agent.create).toHaveBeenCalledWith({
        data: {
          ownerUserId: "u-test",
          name: "claude",
          label: "Claude",
          policyText: null,
        },
      });
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      const anonApp = await buildAgentsTestApp({ user: null, prisma });
      const res = await anonApp.inject({
        method: "POST",
        url: "/api/agents",
        payload: { name: "claude", label: "Claude" },
      });
      expect(res.statusCode).toBe(401);
      await anonApp.close();
    });
  });

  describe("GET /api/agents", () => {
    it("returns the agent list", async () => {
      prisma.agent.findMany.mockResolvedValue([
        {
          id: "ag1",
          ownerUserId: "u-test",
          name: "bot",
          label: "Bot",
          policyText: null,
          createdAt: new Date(),
          lastSeenAt: null,
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/agents" });
      expect(res.statusCode).toBe(200);
      expect(res.json().agents).toHaveLength(1);
    });
  });

  describe("DELETE /api/agents/:id", () => {
    it("deletes owned agent and returns 204", async () => {
      prisma.agent.findUnique.mockResolvedValue({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      });
      prisma.agent.delete.mockResolvedValue({});

      const res = await app.inject({ method: "DELETE", url: "/api/agents/ag1" });
      expect(res.statusCode).toBe(204);
      expect(prisma.agent.delete).toHaveBeenCalledWith({ where: { id: "ag1" } });
    });

    it("returns 404 for unowned agent", async () => {
      prisma.agent.findUnique.mockResolvedValue({
        id: "ag1",
        ownerUserId: "other",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      });

      const res = await app.inject({ method: "DELETE", url: "/api/agents/ag1" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when agent missing", async () => {
      prisma.agent.findUnique.mockResolvedValue(null);
      const res = await app.inject({ method: "DELETE", url: "/api/agents/missing" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/agents/:id/policies", () => {
    it("sets policy and returns 204", async () => {
      prisma.agent.findUnique.mockResolvedValue({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      });
      prisma.agent.update.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/ag1/policies",
        payload: { policyText: "permit(principal, action, resource);" },
      });
      expect(res.statusCode).toBe(204);
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: "ag1" },
        data: { policyText: "permit(principal, action, resource);" },
      });
    });
  });

  describe("POST /api/agents/:id/tokens", () => {
    it("mints a token and returns 201", async () => {
      prisma.agent.findUnique.mockResolvedValue({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      });
      prisma.agentToken.create.mockResolvedValue({
        id: "tid1",
        agentId: "ag1",
        tokenHash: "h",
        scope: null,
        expiresAt: new Date("2027-01-01"),
        revokedAt: null,
        createdAt: new Date(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/ag1/tokens",
        payload: { expiresInSeconds: 3600 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tokenId).toBe("tid1");
      expect(typeof body.token).toBe("string");
    });
  });

  describe("POST /api/agents/tokens/:tokenId/revoke", () => {
    it("revokes a token and returns 204", async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        id: "tid1",
        agentId: "ag1",
        tokenHash: "h",
        scope: null,
        expiresAt: new Date("2027-01-01"),
        revokedAt: null,
        createdAt: new Date(),
      });
      prisma.agent.findUnique.mockResolvedValue({
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      });
      prisma.agentToken.update.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/api/agents/tokens/tid1/revoke",
      });
      expect(res.statusCode).toBe(204);
      expect(prisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: "tid1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("returns 404 for missing token", async () => {
      prisma.agentToken.findUnique.mockResolvedValue(null);
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/tokens/unknown/revoke",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
