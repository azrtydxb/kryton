import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import { getUserNotesDir } from "../services/userNotesDir";

/**
 * @swagger
 * /templates:
 *   get:
 *     summary: List all templates
 *     description: Returns a list of all markdown templates available in the Templates directory.
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: List of templates
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: Meeting Notes
 *                   path:
 *                     type: string
 *                     example: Templates/Meeting Notes.md
 *       500:
 *         description: Failed to list templates
 */
/**
 * @swagger
 * /templates/{name}:
 *   get:
 *     summary: Get template content
 *     description: Returns the content of a specific template by name.
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Template name (without .md extension)
 *         example: Meeting Notes
 *     responses:
 *       200:
 *         description: Template content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: Meeting Notes
 *                 content:
 *                   type: string
 *                   example: "# {{title}}\n\n## Date\n{{date}}"
 *       400:
 *         description: Invalid template name
 *       404:
 *         description: Template not found
 *       500:
 *         description: Failed to read template
 */
export function createTemplatesRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/templates — List all templates
  router.get("/", async (req: Request, res: Response) => {
    try {
      const userDir = await getUserNotesDir(notesDir, req.user!.id);
      const templatesDir = path.join(userDir, "Templates");

      // Ensure templates directory exists
      await fs.mkdir(templatesDir, { recursive: true });

      const entries = await fs.readdir(templatesDir, { withFileTypes: true });
      const templates = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => ({
          name: e.name.replace(/\.md$/, ""),
          path: `Templates/${e.name}`,
        }));

      res.json(templates);
    } catch (err) {
      console.error("Error listing templates:", err);
      res.status(500).json({ error: "Failed to list templates" });
    }
  });

  // GET /api/templates/:name — Get template content
  router.get("/:name", async (req: Request, res: Response) => {
    try {
      const userDir = await getUserNotesDir(notesDir, req.user!.id);
      const templatesDir = path.join(userDir, "Templates");
      const { name } = req.params;
      const filePath = path.join(templatesDir, `${name}.md`);

      // Security check
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(templatesDir) + path.sep)) {
        res.status(400).json({ error: "Invalid template name" });
        return;
      }

      const content = await fs.readFile(filePath, "utf-8");
      res.json({ name, content });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      console.error("Error reading template:", err);
      res.status(500).json({ error: "Failed to read template" });
    }
  });

  return router;
}
