import { Router, Request, Response, NextFunction } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import { getUserNotesDir } from "../services/userNotesDir";
import { requireUser } from "../middleware/auth.js";
import { validatePathWithinBase } from "../lib/pathUtils.js";

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
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
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
      next(err);
    }
  });

  // GET /api/templates/:name — Get template content
  router.get("/:name", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const templatesDir = path.join(userDir, "Templates");
      const { name } = req.params;
      const filePath = path.join(templatesDir, `${name}.md`);

      // Security check
      validatePathWithinBase(filePath, templatesDir);

      const content = await fs.readFile(filePath, "utf-8");
      res.json({ name, content });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
