import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";
import { validate, updateSettingSchema } from "../lib/validation.js";
import { requireUser } from "../middleware/auth.js";

/**
 * @swagger
 * /settings:
 *   get:
 *     summary: Get all settings
 *     description: Returns all application settings as a key-value object.
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Settings as key-value pairs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: string
 *               example:
 *                 dailyNoteTemplate: "# Daily Note — {{date}}"
 *                 theme: dark
 *       500:
 *         description: Failed to fetch settings
 */
/**
 * @swagger
 * /settings/{key}:
 *   put:
 *     summary: Update a setting
 *     description: Creates or updates a setting by key.
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The setting key
 *         example: theme
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: string
 *                 description: The setting value
 *                 example: dark
 *     responses:
 *       200:
 *         description: Setting updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 value:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: Setting updated
 *       400:
 *         description: Value is required
 *       500:
 *         description: Failed to update setting
 */
export function createSettingsRouter(): Router {
  const router = Router();

  // GET /api/settings — Get all settings
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userSettings = await prisma.settings.findMany({
        where: { userId: user.id },
      });

      // Merge: user settings override global for same key
      const result: Record<string, string> = {};
      for (const setting of userSettings) {
        result[setting.key] = setting.value;
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/settings/:key — Update a setting
  router.put("/:key", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const key = req.params.key as string;

      const ADMIN_ONLY_KEYS = ["registration_mode"];
      if (ADMIN_ONLY_KEYS.includes(key)) {
        res.status(403).json({ error: "This setting requires admin access" });
        return;
      }

      const parsed = validate(updateSettingSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { value } = parsed.data;

      await prisma.settings.upsert({
        where: { key_userId: { key, userId: user.id } },
        create: { key, userId: user.id, value },
        update: { value },
      });

      res.json({ key, value, message: "Setting updated" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
