import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Settings } from "../entities/Settings";

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
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const repo = AppDataSource.getRepository(Settings);
      const settings = await repo.find();

      // Return as key-value object
      const result: Record<string, string> = {};
      for (const setting of settings) {
        result[setting.key] = setting.value;
      }

      res.json(result);
    } catch (err) {
      console.error("Error fetching settings:", err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // PUT /api/settings/:key — Update a setting
  router.put("/:key", async (req: Request, res: Response) => {
    try {
      const key = req.params.key as string;
      const { value } = req.body as { value?: string };

      if (value === undefined) {
        res.status(400).json({ error: "Value is required" });
        return;
      }

      const repo = AppDataSource.getRepository(Settings);
      const setting = new Settings();
      setting.key = key;
      setting.value = value;

      await repo.save(setting);
      res.json({ key, value, message: "Setting updated" });
    } catch (err) {
      console.error("Error updating setting:", err);
      res.status(500).json({ error: "Failed to update setting" });
    }
  });

  return router;
}
