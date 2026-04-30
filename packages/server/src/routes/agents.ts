import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import {
  createAgent,
  mintToken,
  revokeToken,
  setAgentPolicy,
  listAgents,
  deleteAgent,
} from "../services/agent.js";
import { prisma } from "../prisma.js";

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
});

const setPolicySchema = z.object({
  policyText: z.string(),
});

const mintTokenSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  scope: z.string().optional(),
});

/**
 * Agent management router.
 *
 * Mount point (add to server.ts at merge time):
 *   app.use("/api/agents", createAgentsRouter());
 */
export function createAgentsRouter(): Router {
  const router = Router();

  /** POST /api/agents — create a new agent */
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const body = createAgentSchema.parse(req.body);
      const agent = await createAgent(user.id, body);
      res.status(201).json(agent);
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/agents — list agents owned by the current user */
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const agents = await listAgents(user.id);
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/agents/:id — delete an agent (and cascade its tokens) */
  router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
      if (!agent || agent.ownerUserId !== user.id) {
        res.status(404).end();
        return;
      }
      await deleteAgent(agent.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/agents/:id/policies — set/replace the Cedar policy for an agent */
  router.post(
    "/:id/policies",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = requireUser(req);
        const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
        if (!agent || agent.ownerUserId !== user.id) {
          res.status(404).end();
          return;
        }
        const body = setPolicySchema.parse(req.body);
        await setAgentPolicy(agent.id, body.policyText);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/agents/:id/tokens — mint a bearer token for an agent */
  router.post(
    "/:id/tokens",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = requireUser(req);
        const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
        if (!agent || agent.ownerUserId !== user.id) {
          res.status(404).end();
          return;
        }
        const body = mintTokenSchema.parse(req.body);
        const result = await mintToken(agent.id, body);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/agents/tokens/:tokenId/revoke — revoke a specific token */
  router.post(
    "/tokens/:tokenId/revoke",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = requireUser(req);
        const token = await prisma.agentToken.findUnique({
          where: { id: req.params.tokenId },
          include: { agent: true },
        });
        if (!token || token.agent.ownerUserId !== user.id) {
          res.status(404).end();
          return;
        }
        await revokeToken(token.id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
