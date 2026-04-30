import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { requirePermission } from "../authz.js";

// Mock the prisma and cedar modules so this stays a unit test
vi.mock("../../prisma.js", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../services/cedar.js", () => ({
  evaluatePolicy: vi.fn(),
}));

import { prisma } from "../../prisma.js";
import { evaluatePolicy } from "../../services/cedar.js";

const mockPrismaAgent = vi.mocked(prisma.agent.findUnique);
const mockEval = vi.mocked(evaluatePolicy);

function makeReq(auth?: { userId: string; agentId: string | null }): Request {
  return { auth } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = vi.fn();

describe("requirePermission middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth on request", async () => {
    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq(undefined);
    const res = makeRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when agentId is null (human user)", async () => {
    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq({ userId: "u1", agentId: null });
    const res = makeRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockPrismaAgent).not.toHaveBeenCalled();
  });

  it("returns 403 when agent has no policy attached", async () => {
    mockPrismaAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u1",
      name: "bot",
      label: "Bot",
      policyText: null,
      createdAt: new Date(),
      lastSeenAt: null,
    });

    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq({ userId: "u1", agentId: "ag1" });
    const res = makeRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when policy allows", async () => {
    mockPrismaAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u1",
      name: "bot",
      label: "Bot",
      policyText: "permit(principal, action, resource);",
      createdAt: new Date(),
      lastSeenAt: null,
    });
    mockEval.mockResolvedValue({ allowed: true });

    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq({ userId: "u1", agentId: "ag1" });
    const res = makeRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 403 when policy denies", async () => {
    mockPrismaAgent.mockResolvedValue({
      id: "ag1",
      ownerUserId: "u1",
      name: "bot",
      label: "Bot",
      policyText: "forbid(principal, action, resource);",
      createdAt: new Date(),
      lastSeenAt: null,
    });
    mockEval.mockResolvedValue({ allowed: false, reasons: ["policy denied"] });

    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq({ userId: "u1", agentId: "ag1" });
    const res = makeRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when agent record not found", async () => {
    mockPrismaAgent.mockResolvedValue(null);

    const middleware = requirePermission("Kryton::Action::\"read\"", () => ({
      type: "Kryton::Note",
      id: "n1",
    }));
    const req = makeReq({ userId: "u1", agentId: "ag-missing" });
    const res = makeRes();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
