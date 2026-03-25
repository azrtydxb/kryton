import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { getSharedNotesForUser } from "../services/shareService.js";
import { validate } from "../lib/validation.js";

const createShareBodySchema = z.object({
  path: z.string().min(1),
  isFolder: z.boolean().optional(),
  sharedWithUserId: z.string().min(1),
  permission: z.enum(["read", "readwrite"]),
});

const updateShareSchema = z.object({
  permission: z.enum(["read", "readwrite"]),
});

/**
 * @swagger
 * /shares:
 *   post:
 *     summary: Create a share
 *     description: Share a note or folder with another user.
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - path
 *               - isFolder
 *               - sharedWithUserId
 *               - permission
 *             properties:
 *               path:
 *                 type: string
 *               isFolder:
 *                 type: boolean
 *               sharedWithUserId:
 *                 type: string
 *               permission:
 *                 type: string
 *                 enum: [read, readwrite]
 *     responses:
 *       201:
 *         description: Share created
 *       400:
 *         description: Invalid request
 *       409:
 *         description: Share already exists
 *       500:
 *         description: Server error
 *   get:
 *     summary: List my shares (as owner)
 *     description: Returns all shares where the current user is the owner.
 *     tags: [Sharing]
 *     responses:
 *       200:
 *         description: List of shares
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /shares/with-me:
 *   get:
 *     summary: List shares with me
 *     description: Returns all notes and folders shared with the current user.
 *     tags: [Sharing]
 *     responses:
 *       200:
 *         description: List of shares with enriched owner info
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /shares/{id}:
 *   put:
 *     summary: Update share permission
 *     description: Update the permission on a share you own.
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - permission
 *             properties:
 *               permission:
 *                 type: string
 *                 enum: [read, readwrite]
 *     responses:
 *       200:
 *         description: Share updated
 *       403:
 *         description: Not the owner
 *       404:
 *         description: Share not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Revoke a share
 *     description: Delete a share you own.
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Share revoked
 *       403:
 *         description: Not the owner
 *       404:
 *         description: Share not found
 *       500:
 *         description: Server error
 */
export function createSharesRouter(): Router {
  const router = Router();

  // POST /api/shares — Create a share
  router.post("/", async (req: Request, res: Response) => {
    try {
      const parsed = validate(createShareBodySchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { path, isFolder, sharedWithUserId, permission } = parsed.data;

      if (sharedWithUserId === req.user!.id) {
        res.status(400).json({ error: "Cannot share with yourself" });
        return;
      }

      const saved = await prisma.noteShare.create({
        data: {
          ownerUserId: req.user!.id,
          path,
          isFolder,
          sharedWithUserId,
          permission,
        },
      });

      res.status(201).json(saved);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.includes("UNIQUE") || err.message.includes("duplicate") || err.message.includes("Unique constraint"))
      ) {
        res.status(409).json({ error: "Share already exists" });
        return;
      }
      console.error("Error creating share:", err);
      res.status(500).json({ error: "Failed to create share" });
    }
  });

  // GET /api/shares — List my shares (as owner)
  router.get("/", async (req: Request, res: Response) => {
    try {
      const shares = await prisma.noteShare.findMany({
        where: { ownerUserId: req.user!.id },
      });
      res.json(shares);
    } catch (err) {
      console.error("Error listing shares:", err);
      res.status(500).json({ error: "Failed to list shares" });
    }
  });

  // GET /api/shares/with-me — List shares with me
  router.get("/with-me", async (req: Request, res: Response) => {
    try {
      const shares = await getSharedNotesForUser(req.user!.id);
      res.json(shares);
    } catch (err) {
      console.error("Error listing shared notes:", err);
      res.status(500).json({ error: "Failed to list shared notes" });
    }
  });

  // PUT /api/shares/:id — Update permission
  router.put("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = validate(updateShareSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { permission } = parsed.data;

      const share = await prisma.noteShare.findUnique({ where: { id } });

      if (!share) {
        res.status(404).json({ error: "Share not found" });
        return;
      }

      if (share.ownerUserId !== req.user!.id) {
        res.status(403).json({ error: "Not the owner of this share" });
        return;
      }

      const updated = await prisma.noteShare.update({
        where: { id },
        data: { permission },
      });
      res.json(updated);
    } catch (err) {
      console.error("Error updating share:", err);
      res.status(500).json({ error: "Failed to update share" });
    }
  });

  // DELETE /api/shares/:id — Revoke share
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const share = await prisma.noteShare.findUnique({ where: { id } });

      if (!share) {
        res.status(404).json({ error: "Share not found" });
        return;
      }

      if (share.ownerUserId !== req.user!.id) {
        res.status(403).json({ error: "Not the owner of this share" });
        return;
      }

      await prisma.noteShare.delete({ where: { id } });
      res.json({ message: "Share revoked" });
    } catch (err) {
      console.error("Error revoking share:", err);
      res.status(500).json({ error: "Failed to revoke share" });
    }
  });

  return router;
}

/**
 * @swagger
 * /access-requests:
 *   post:
 *     summary: Request access to a note
 *     description: Create an access request for a note owned by another user.
 *     tags: [Access Requests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ownerUserId
 *               - notePath
 *             properties:
 *               ownerUserId:
 *                 type: string
 *               notePath:
 *                 type: string
 *     responses:
 *       201:
 *         description: Access request created
 *       200:
 *         description: Existing request returned or re-opened
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 *   get:
 *     summary: List pending access requests (as owner)
 *     description: Returns pending access requests where the current user is the note owner.
 *     tags: [Access Requests]
 *     responses:
 *       200:
 *         description: List of pending access requests
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /access-requests/mine:
 *   get:
 *     summary: List my outgoing access requests
 *     description: Returns all access requests made by the current user.
 *     tags: [Access Requests]
 *     responses:
 *       200:
 *         description: List of outgoing access requests
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /access-requests/{id}:
 *   put:
 *     summary: Approve or deny an access request
 *     description: Approve or deny a pending access request for a note you own.
 *     tags: [Access Requests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, deny]
 *               permission:
 *                 type: string
 *                 enum: [read, readwrite]
 *                 description: Required when action is approve
 *     responses:
 *       200:
 *         description: Access request updated
 *       400:
 *         description: Invalid action
 *       403:
 *         description: Not the owner
 *       404:
 *         description: Access request not found
 *       500:
 *         description: Server error
 */
export function createAccessRequestsRouter(): Router {
  const router = Router();

  // POST /api/access-requests — Request access
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { ownerUserId, notePath } = req.body as {
        ownerUserId?: string;
        notePath?: string;
      };

      if (!ownerUserId || !notePath) {
        res.status(400).json({ error: "ownerUserId and notePath are required" });
        return;
      }

      const existing = await prisma.accessRequest.findFirst({
        where: {
          requesterUserId: req.user!.id,
          ownerUserId,
          notePath,
        },
      });

      if (existing) {
        if (existing.status === "denied") {
          const updated = await prisma.accessRequest.update({
            where: { id: existing.id },
            data: { status: "pending" },
          });
          res.json(updated);
          return;
        }
        // pending or approved — return as-is
        res.json(existing);
        return;
      }

      const saved = await prisma.accessRequest.create({
        data: {
          requesterUserId: req.user!.id,
          ownerUserId,
          notePath,
          status: "pending",
        },
      });

      res.status(201).json(saved);
    } catch (err) {
      console.error("Error creating access request:", err);
      res.status(500).json({ error: "Failed to create access request" });
    }
  });

  // GET /api/access-requests — List pending requests I need to act on (as owner)
  router.get("/", async (req: Request, res: Response) => {
    try {
      const requests = await prisma.accessRequest.findMany({
        where: {
          ownerUserId: req.user!.id,
          status: "pending",
        },
        include: {
          requester: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      res.json(requests);
    } catch (err) {
      console.error("Error listing access requests:", err);
      res.status(500).json({ error: "Failed to list access requests" });
    }
  });

  // GET /api/access-requests/mine — List my outgoing requests
  router.get("/mine", async (req: Request, res: Response) => {
    try {
      const requests = await prisma.accessRequest.findMany({
        where: { requesterUserId: req.user!.id },
      });
      res.json(requests);
    } catch (err) {
      console.error("Error listing my access requests:", err);
      res.status(500).json({ error: "Failed to list access requests" });
    }
  });

  // PUT /api/access-requests/:id — Approve or deny
  router.put("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { action, permission } = req.body as {
        action?: "approve" | "deny";
        permission?: "read" | "readwrite";
      };

      if (!action || (action !== "approve" && action !== "deny")) {
        res.status(400).json({ error: "action must be 'approve' or 'deny'" });
        return;
      }

      const request = await prisma.accessRequest.findUnique({ where: { id } });

      if (!request) {
        res.status(404).json({ error: "Access request not found" });
        return;
      }

      if (request.ownerUserId !== req.user!.id) {
        res.status(403).json({ error: "Not the owner of the requested note" });
        return;
      }

      if (action === "approve") {
        if (!permission) {
          res.status(400).json({ error: "permission is required when approving" });
          return;
        }

        // Create NoteShare
        await prisma.noteShare.create({
          data: {
            ownerUserId: request.ownerUserId,
            path: request.notePath,
            isFolder: false,
            sharedWithUserId: request.requesterUserId,
            permission,
          },
        });

        const updated = await prisma.accessRequest.update({
          where: { id },
          data: { status: "approved" },
        });
        res.json(updated);
      } else {
        const updated = await prisma.accessRequest.update({
          where: { id },
          data: { status: "denied" },
        });
        res.json(updated);
      }
    } catch (err) {
      console.error("Error updating access request:", err);
      res.status(500).json({ error: "Failed to update access request" });
    }
  });

  return router;
}
