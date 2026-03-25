import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";
import { requireUser, requireSession } from "../middleware/auth.js";
import { GLOBAL_USER_ID } from "../lib/pathUtils.js";
import {
  validate,
  updateUserSchema,
  resetPasswordSchema,
  createInviteSchema,
  registrationModeSchema,
} from "../lib/validation.js";

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users
 *     description: Returns all users ordered by creation date descending. Requires admin role.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   email:
 *                     type: string
 *                   name:
 *                     type: string
 *                   role:
 *                     type: string
 *                   disabled:
 *                     type: boolean
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to list users
 */
/**
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     summary: Update a user
 *     description: Update user disabled status or role. Cannot modify self.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               disabled:
 *                 type: boolean
 *               role:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *                 role:
 *                   type: string
 *                 disabled:
 *                   type: boolean
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Cannot modify yourself
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to update user
 */
/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: Delete a user and cascade delete their data. Cannot delete self.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Cannot delete yourself
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to delete user
 */
/**
 * @swagger
 * /admin/invites:
 *   post:
 *     summary: Create an invite code
 *     description: Generate a random 8-character hex invite code. Requires admin role.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date
 *     responses:
 *       200:
 *         description: Created invite code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 code:
 *                   type: string
 *                 createdById:
 *                   type: string
 *                 usedById:
 *                   type: string
 *                   nullable: true
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to create invite
 */
/**
 * @swagger
 * /admin/invites:
 *   get:
 *     summary: List all invite codes
 *     description: Returns all invite codes ordered by creation date descending. Requires admin role.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of invite codes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   code:
 *                     type: string
 *                   createdById:
 *                     type: string
 *                   usedById:
 *                     type: string
 *                     nullable: true
 *                   expiresAt:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to list invites
 */
/**
 * @swagger
 * /admin/invites/{id}:
 *   delete:
 *     summary: Delete an invite code
 *     description: Delete an invite code by ID. Requires admin role.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Invite code ID
 *     responses:
 *       200:
 *         description: Invite deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Invite not found
 *       500:
 *         description: Failed to delete invite
 */
/**
 * @swagger
 * /admin/settings/registration:
 *   get:
 *     summary: Get registration mode
 *     description: Read the current registration mode from settings. Defaults to "open" if not set.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Registration mode
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mode:
 *                   type: string
 *                   enum: [open, invite-only]
 *                   example: open
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to read registration setting
 */
/**
 * @swagger
 * /admin/settings/registration:
 *   put:
 *     summary: Update registration mode
 *     description: Set the registration mode to "open" or "invite-only".
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode]
 *             properties:
 *               mode:
 *                 type: string
 *                 enum: [open, invite-only]
 *     responses:
 *       200:
 *         description: Registration mode updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mode:
 *                   type: string
 *                   enum: [open, invite-only]
 *       400:
 *         description: Invalid mode
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to update registration setting
 */
export function createAdminRouter(): Router {
  const router = Router();

  // GET /users — list all users
  router.get("/users", async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      requireSession(req);
      const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, role: true, disabled: true, createdAt: true },
      });
      res.json(users);
    } catch (err) {
      next(err);
    }
  });

  // PUT /users/:id — update user
  router.put("/users/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = requireUser(req);
      requireSession(req);
      const userId = req.params.id as string;

      if (userId === currentUser.id) {
        res.status(400).json({ error: "Cannot modify yourself" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const parsed = validate(updateUserSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { disabled, role } = parsed.data;

      let shouldInvalidateTokens = false;
      const updateData: Record<string, unknown> = {};

      if (typeof disabled === "boolean") {
        if (disabled && !user.disabled) {
          shouldInvalidateTokens = true;
        }
        updateData.disabled = disabled;
      }

      if (typeof role === "string") {
        if (role !== user.role) {
          shouldInvalidateTokens = true;
        }
        updateData.role = role;
      }

      if (shouldInvalidateTokens) {
        await prisma.session.deleteMany({ where: { userId } });
      }

      const saved = await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      res.json({
        id: saved.id,
        email: saved.email,
        name: saved.name,
        role: saved.role,
        disabled: saved.disabled,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /users/:id — delete user
  router.delete("/users/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = requireUser(req);
      requireSession(req);
      const userId = req.params.id as string;

      if (userId === currentUser.id) {
        res.status(400).json({ error: "Cannot delete yourself" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Clean up user's domain data first
      await prisma.searchIndex.deleteMany({ where: { userId } });
      await prisma.graphEdge.deleteMany({ where: { userId } });
      await prisma.settings.deleteMany({ where: { userId } });

      // Clean up NoteShare and AccessRequest rows
      await prisma.noteShare.deleteMany({ where: { ownerUserId: userId } });
      await prisma.noteShare.deleteMany({ where: { sharedWithUserId: userId } });
      await prisma.accessRequest.deleteMany({ where: { requesterUserId: userId } });
      await prisma.accessRequest.deleteMany({ where: { ownerUserId: userId } });

      // Delete user (cascades to sessions, accounts, passkeys via Prisma schema)
      await prisma.user.delete({ where: { id: userId } });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /admin/users/{id}/reset-password:
   *   post:
   *     summary: Reset a user's password (admin only)
   *     tags: [Admin]
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
   *             required: [newPassword]
   *             properties:
   *               newPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Password reset
   */
  router.post("/users/:id/reset-password", async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      requireSession(req);
      const userId = req.params.id as string;
      const parsed = validate(resetPasswordSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { newPassword } = parsed.data;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Update password in the credential Account (better-auth stores passwords in the Account table)
      const { hashPassword } = await import("better-auth/crypto");
      const hashedPassword = await hashPassword(newPassword);

      await prisma.account.updateMany({
        where: { userId, providerId: "credential" },
        data: { password: hashedPassword },
      });

      // Invalidate all sessions so user must log in with new password
      await prisma.session.deleteMany({ where: { userId } });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /invites — create invite code
  router.post("/invites", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);
      const parsed = validate(createInviteSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const code = crypto.randomBytes(4).toString("hex"); // 8-char hex

      const saved = await prisma.inviteCode.create({
        data: {
          code,
          createdById: user.id,
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        },
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  });

  // GET /invites — list all invites
  router.get("/invites", async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      requireSession(req);
      const invites = await prisma.inviteCode.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, code: true, createdById: true, usedById: true, expiresAt: true, createdAt: true },
      });
      res.json(invites);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /invites/:id — delete invite
  router.delete("/invites/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      requireSession(req);
      const inviteId = req.params.id as string;

      const invite = await prisma.inviteCode.findUnique({ where: { id: inviteId } });
      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      await prisma.inviteCode.delete({ where: { id: inviteId } });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /settings/registration — read registration mode
  router.get(
    "/settings/registration",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireUser(req);
        requireSession(req);
        // Registration mode is stored as a global setting with a sentinel userId
        const rows = await prisma.settings.findMany({
          where: { key: "registration_mode" },
        });
        const row = rows.find((r) => r.userId === GLOBAL_USER_ID) ?? rows[0];
        const mode = row?.value ?? "open";
        res.json({ mode });
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /settings/registration — update registration mode
  router.put(
    "/settings/registration",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireUser(req);
        requireSession(req);
        const parsed = validate(registrationModeSchema, req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error });
          return;
        }
        const { mode } = parsed.data;

        await prisma.settings.upsert({
          where: { key_userId: { key: "registration_mode", userId: GLOBAL_USER_ID } },
          create: { key: "registration_mode", userId: GLOBAL_USER_ID, value: mode },
          update: { value: mode },
        });

        res.json({ mode });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
