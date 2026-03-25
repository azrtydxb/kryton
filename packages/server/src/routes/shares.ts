import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { getSharedNotesForUser } from "../services/shareService.js";
import {
  validate,
  createShareSchema,
  updateShareSchema,
  createAccessRequestSchema,
  updateAccessRequestSchema,
} from "../lib/validation.js";
import { requireUser, requireScope } from "../middleware/auth.js";

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
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const parsed = validate(createShareSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { path, isFolder, sharedWithUserId, permission } = parsed.data;

      if (sharedWithUserId === user.id) {
        res.status(400).json({ error: "Cannot share with yourself" });
        return;
      }

      const saved = await prisma.noteShare.create({
        data: {
          ownerUserId: user.id,
          path,
          isFolder: isFolder ?? false,
          sharedWithUserId,
          permission,
        },
      });

      res.status(201).json(saved);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Share already exists" });
        return;
      }
      next(err);
    }
  });

  // GET /api/shares — List my shares (as owner)
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const shares = await prisma.noteShare.findMany({
        where: { ownerUserId: user.id },
      });
      res.json(shares);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/shares/with-me — List shares with me
  router.get("/with-me", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const shares = await getSharedNotesForUser(user.id);
      res.json(shares);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/shares/:id — Update permission
  router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
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

      if (share.ownerUserId !== user.id) {
        res.status(403).json({ error: "Not the owner of this share" });
        return;
      }

      const updated = await prisma.noteShare.update({
        where: { id },
        data: { permission },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/shares/:id — Revoke share
  router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const id = req.params.id as string;
      const share = await prisma.noteShare.findUnique({ where: { id } });

      if (!share) {
        res.status(404).json({ error: "Share not found" });
        return;
      }

      if (share.ownerUserId !== user.id) {
        res.status(403).json({ error: "Not the owner of this share" });
        return;
      }

      await prisma.noteShare.delete({ where: { id } });
      res.json({ message: "Share revoked" });
    } catch (err) {
      next(err);
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
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const parsed = validate(createAccessRequestSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { ownerUserId, notePath } = parsed.data;

      const ownerUser = await prisma.user.findUnique({ where: { id: ownerUserId } });
      if (!ownerUser) {
        res.status(400).json({ error: "Owner user not found" });
        return;
      }

      const existing = await prisma.accessRequest.findFirst({
        where: {
          requesterUserId: user.id,
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
          requesterUserId: user.id,
          ownerUserId,
          notePath,
          status: "pending",
        },
      });

      res.status(201).json(saved);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/access-requests — List pending requests I need to act on (as owner)
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const requests = await prisma.accessRequest.findMany({
        where: {
          ownerUserId: user.id,
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
      next(err);
    }
  });

  // GET /api/access-requests/mine — List my outgoing requests
  router.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const requests = await prisma.accessRequest.findMany({
        where: { requesterUserId: user.id },
      });
      res.json(requests);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/access-requests/:id — Approve or deny
  router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const id = req.params.id as string;
      const parsed = validate(updateAccessRequestSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { action, permission } = parsed.data;

      const request = await prisma.accessRequest.findUnique({ where: { id } });

      if (!request) {
        res.status(404).json({ error: "Access request not found" });
        return;
      }

      if (request.ownerUserId !== user.id) {
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
      next(err);
    }
  });

  return router;
}
