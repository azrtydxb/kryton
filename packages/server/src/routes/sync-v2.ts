import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireUser } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authz.js";
import { pullChanges, pushChanges } from "../services/sync-v2.js";


const SYNC_RESOURCE = { type: "Kryton::Sync", id: "*" };

export function createSyncV2Router(): Router {
  const router = Router();

  // POST /api/sync/v2/pull
  router.post("/pull", requirePermission('Kryton::Action::"sync"', () => SYNC_RESOURCE), async (req: Request, res: Response) => {
    try {
      const user = requireUser(req);
      const body = z.object({ cursor: z.string().default("0") }).parse(req.body);
      const result = await pullChanges(user.id, BigInt(body.cursor));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Pull failed" });
    }
  });

  // POST /api/sync/v2/push
  router.post("/push", requirePermission('Kryton::Action::"sync"', () => SYNC_RESOURCE), async (req: Request, res: Response) => {
    try {
      const user = requireUser(req);
      const body = z.object({
        changes: z.record(z.string(), z.array(z.any())),
      }).parse(req.body);
      const result = await pushChanges(user.id, body.changes as Parameters<typeof pushChanges>[1]);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Push failed" });
    }
  });

  // GET /api/sync/v2/tier2/:entityType/:parentId
  router.get("/tier2/:entityType/:parentId", async (req: Request, res: Response) => {
    try {
      const user = requireUser(req);
      const entityType = req.params.entityType as string;
      const parentId = req.params.parentId as string;
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10) || 50, 200);

      if (entityType === "history") {
        const rows = await prisma.noteRevision.findMany({
          where: { userId: user.id, notePath: parentId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        res.json({ entities: rows });
        return;
      }

      if (entityType === "access_requests") {
        const rows = await prisma.accessRequest.findMany({
          where: { ownerUserId: user.id, notePath: parentId },
          take: limit,
        });
        res.json({ entities: rows });
        return;
      }

      if (entityType === "plugin_storage") {
        const rows = await prisma.pluginStorage.findMany({
          where: { pluginId: parentId },
          take: limit,
        });
        res.json({ entities: rows });
        return;
      }

      res.status(404).json({ error: "unknown entity type" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Tier2 fetch failed" });
    }
  });

  return router;
}
