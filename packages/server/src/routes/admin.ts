import crypto from "crypto";
import { Router, Request, Response } from "express";
import { IsNull } from "typeorm";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { InviteCode } from "../entities/InviteCode";
import { Settings } from "../entities/Settings";
import { deleteAllUserRefreshTokens } from "../services/tokenService";

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
 *     description: Update user disabled status or role. Cannot modify self. Invalidates all refresh tokens when disabling or changing role.
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
 *     description: Delete a user and cascade delete their AuthProvider and RefreshToken records. Cannot delete self.
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
 *                 createdBy:
 *                   type: string
 *                 usedBy:
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
 *                   createdBy:
 *                     type: string
 *                   usedBy:
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
  router.get("/users", async (_req: Request, res: Response) => {
    try {
      const userRepo = AppDataSource.getRepository(User);
      const users = await userRepo.find({
        order: { createdAt: "DESC" },
        select: ["id", "email", "name", "role", "disabled", "createdAt"],
      });
      res.json(users);
    } catch (err) {
      console.error("Error listing users:", err);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  // PUT /users/:id — update user
  router.put("/users/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;

      if (userId === req.user!.id) {
        res.status(400).json({ error: "Cannot modify yourself" });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: userId });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { disabled, role } = req.body as {
        disabled?: boolean;
        role?: string;
      };

      let shouldInvalidateTokens = false;

      if (typeof disabled === "boolean") {
        if (disabled && !user.disabled) {
          shouldInvalidateTokens = true;
        }
        user.disabled = disabled;
      }

      if (typeof role === "string") {
        if (role !== user.role) {
          shouldInvalidateTokens = true;
        }
        user.role = role;
      }

      if (shouldInvalidateTokens) {
        await deleteAllUserRefreshTokens(userId);
      }

      const saved = await userRepo.save(user);

      res.json({
        id: saved.id,
        email: saved.email,
        name: saved.name,
        role: saved.role,
        disabled: saved.disabled,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      console.error("Error updating user:", err);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // DELETE /users/:id — delete user
  router.delete("/users/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;

      if (userId === req.user!.id) {
        res.status(400).json({ error: "Cannot delete yourself" });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: userId });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Cascade delete AuthProvider and RefreshToken via query builder
      await AppDataSource.getRepository("AuthProvider").delete({
        userId,
      });
      await AppDataSource.getRepository("RefreshToken").delete({
        userId,
      });
      await userRepo.remove(user);

      res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting user:", err);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // POST /invites — create invite code
  router.post("/invites", async (req: Request, res: Response) => {
    try {
      const { expiresAt } = req.body as { expiresAt?: string };
      const inviteRepo = AppDataSource.getRepository(InviteCode);

      const code = crypto.randomBytes(4).toString("hex"); // 8-char hex

      const invite = inviteRepo.create({
        code,
        createdBy: req.user!.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      const saved = await inviteRepo.save(invite);
      res.json(saved);
    } catch (err) {
      console.error("Error creating invite:", err);
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  // GET /invites — list all invites
  router.get("/invites", async (_req: Request, res: Response) => {
    try {
      const inviteRepo = AppDataSource.getRepository(InviteCode);
      const invites = await inviteRepo.find({
        order: { createdAt: "DESC" },
        select: ["id", "code", "createdBy", "usedBy", "expiresAt", "createdAt"],
      });
      res.json(invites);
    } catch (err) {
      console.error("Error listing invites:", err);
      res.status(500).json({ error: "Failed to list invites" });
    }
  });

  // DELETE /invites/:id — delete invite
  router.delete("/invites/:id", async (req: Request, res: Response) => {
    try {
      const inviteId = req.params.id as string;
      const inviteRepo = AppDataSource.getRepository(InviteCode);

      const invite = await inviteRepo.findOneBy({ id: inviteId });
      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      await inviteRepo.remove(invite);
      res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting invite:", err);
      res.status(500).json({ error: "Failed to delete invite" });
    }
  });

  // GET /settings/registration — read registration mode
  router.get(
    "/settings/registration",
    async (_req: Request, res: Response) => {
      try {
        const settingsRepo = AppDataSource.getRepository(Settings);
        const row = await settingsRepo.findOneBy({
          key: "registration_mode",
          userId: IsNull(),
        });
        const mode = row?.value ?? "open";
        res.json({ mode });
      } catch (err) {
        console.error("Error reading registration setting:", err);
        res.status(500).json({ error: "Failed to read registration setting" });
      }
    },
  );

  // PUT /settings/registration — update registration mode
  router.put(
    "/settings/registration",
    async (req: Request, res: Response) => {
      try {
        const { mode } = req.body as { mode?: string };

        if (mode !== "open" && mode !== "invite-only") {
          res.status(400).json({ error: "Invalid mode. Must be 'open' or 'invite-only'" });
          return;
        }

        const settingsRepo = AppDataSource.getRepository(Settings);
        let row = await settingsRepo.findOneBy({
          key: "registration_mode",
          userId: IsNull(),
        });
        if (!row) {
          row = new Settings();
          row.key = "registration_mode";
          row.userId = null;
        }
        row.value = mode;
        await settingsRepo.save(row);

        res.json({ mode });
      } catch (err) {
        console.error("Error updating registration setting:", err);
        res
          .status(500)
          .json({ error: "Failed to update registration setting" });
      }
    },
  );

  return router;
}
