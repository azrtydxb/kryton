import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Settings } from "../entities/Settings";

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
      const { key } = req.params;
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
