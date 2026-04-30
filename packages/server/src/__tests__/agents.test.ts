/**
 * Integration tests for /api/agents routes.
 *
 * Uses supertest against an Express app with the agents router mounted.
 * Auth is bypassed by injecting a mock user directly into req.user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import * as agentService from "../services/agent.js";
import * as prismaModule from "../prisma.js";
import { createAgentsRouter } from "../routes/agents.js";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock("../services/agent.js");
vi.mock("../prisma.js", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(),
    },
    agentToken: {
      findUnique: vi.fn(),
    },
  },
}));

const mockCreateAgent = vi.mocked(agentService.createAgent);
const mockListAgents = vi.mocked(agentService.listAgents);
const mockDeleteAgent = vi.mocked(agentService.deleteAgent);
const mockSetPolicy = vi.mocked(agentService.setAgentPolicy);
const mockMintToken = vi.mocked(agentService.mintToken);
const mockRevokeToken = vi.mocked(agentService.revokeToken);
const mockFindAgent = vi.mocked(prismaModule.prisma.agent.findUnique);
const mockFindToken = vi.mocked(prismaModule.prisma.agentToken.findUnique);

// ------------------------------------------------------------------
// App setup — injects a fake authenticated user
// ------------------------------------------------------------------

function buildApp(userId = "u-test") {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware: inject req.user
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: userId, email: "test@example.com", name: "Test", role: "user" };
    next();
  });

  app.use("/api/agents", createAgentsRouter());

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof Error && err.name === "ZodError") {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("POST /api/agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an agent and returns 201", async () => {
    mockCreateAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u-test",
      name: "claude",
      label: "Claude",
      policyText: null,
      createdAt: new Date("2026-01-01"),
      lastSeenAt: null,
    });

    const res = await request(buildApp())
      .post("/api/agents")
      .send({ name: "claude", label: "Claude" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("ag1");
    expect(mockCreateAgent).toHaveBeenCalledWith("u-test", { name: "claude", label: "Claude" });
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request(buildApp())
      .post("/api/agents")
      .send({ name: "claude" }); // missing label

    expect(res.status).toBe(400);
  });
});

describe("GET /api/agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns agent list", async () => {
    mockListAgents.mockResolvedValue([
      { id: "ag1", ownerUserId: "u-test", name: "bot", label: "Bot", policyText: null, createdAt: new Date(), lastSeenAt: null },
    ]);

    const res = await request(buildApp()).get("/api/agents");
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
  });
});

describe("DELETE /api/agents/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes owned agent and returns 204", async () => {
    mockFindAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u-test",
      name: "bot",
      label: "Bot",
      policyText: null,
      createdAt: new Date(),
      lastSeenAt: null,
    });
    mockDeleteAgent.mockResolvedValue(undefined);

    const res = await request(buildApp()).delete("/api/agents/ag1");
    expect(res.status).toBe(204);
    expect(mockDeleteAgent).toHaveBeenCalledWith("ag1");
  });

  it("returns 404 for unowned agent", async () => {
    mockFindAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "other-user",
      name: "bot",
      label: "Bot",
      policyText: null,
      createdAt: new Date(),
      lastSeenAt: null,
    });

    const res = await request(buildApp()).delete("/api/agents/ag1");
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent agent", async () => {
    mockFindAgent.mockResolvedValue(null);

    const res = await request(buildApp()).delete("/api/agents/unknown");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/agents/:id/policies", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets policy and returns 204", async () => {
    mockFindAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u-test",
      name: "bot",
      label: "Bot",
      policyText: null,
      createdAt: new Date(),
      lastSeenAt: null,
    });
    mockSetPolicy.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u-test",
      name: "bot",
      label: "Bot",
      policyText: "permit(principal, action, resource);",
      createdAt: new Date(),
      lastSeenAt: null,
    });

    const res = await request(buildApp())
      .post("/api/agents/ag1/policies")
      .send({ policyText: "permit(principal, action, resource);" });

    expect(res.status).toBe(204);
    expect(mockSetPolicy).toHaveBeenCalledWith("ag1", "permit(principal, action, resource);");
  });
});

describe("POST /api/agents/:id/tokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mints a token and returns 201", async () => {
    mockFindAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u-test",
      name: "bot",
      label: "Bot",
      policyText: null,
      createdAt: new Date(),
      lastSeenAt: null,
    });
    mockMintToken.mockResolvedValue({
      token: "tok-raw",
      tokenId: "tid1",
      expiresAt: new Date("2027-01-01"),
    });

    const res = await request(buildApp())
      .post("/api/agents/ag1/tokens")
      .send({ expiresInSeconds: 3600 });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("tok-raw");
    expect(res.body.tokenId).toBe("tid1");
  });
});

describe("POST /api/agents/tokens/:tokenId/revoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes a token and returns 204", async () => {
    mockFindToken.mockResolvedValue({
      id: "tid1",
      agentId: "ag1",
      tokenHash: "hash",
      scope: null,
      expiresAt: new Date("2027-01-01"),
      revokedAt: null,
      createdAt: new Date(),
      agent: {
        id: "ag1",
        ownerUserId: "u-test",
        name: "bot",
        label: "Bot",
        policyText: null,
        createdAt: new Date(),
        lastSeenAt: null,
      },
    } as any);
    mockRevokeToken.mockResolvedValue(undefined);

    const res = await request(buildApp()).post("/api/agents/tokens/tid1/revoke");
    expect(res.status).toBe(204);
    expect(mockRevokeToken).toHaveBeenCalledWith("tid1");
  });
});
