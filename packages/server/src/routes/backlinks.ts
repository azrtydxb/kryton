import { Router, Request, Response } from "express";
import { getBacklinks } from "../services/graphService";

/**
 * @swagger
 * /backlinks/{path}:
 *   get:
 *     summary: Get backlinks for a note
 *     description: Returns a list of notes that contain wiki-links pointing to the specified note.
 *     tags: [Backlinks]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path of the target note
 *         example: Welcome
 *     responses:
 *       200:
 *         description: List of backlinks
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   path:
 *                     type: string
 *                     example: Projects/Mnemo Roadmap.md
 *                   title:
 *                     type: string
 *                     example: Mnemo Roadmap
 *       400:
 *         description: Path is required
 *       500:
 *         description: Failed to fetch backlinks
 */
export function createBacklinksRouter(): Router {
  const router = Router();

  // GET /api/backlinks/:path(*) — Get notes that link TO this note
  router.get("/{*path}", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
      if (!notePath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const fullNotePath = notePath.endsWith(".md")
        ? notePath
        : `${notePath}.md`;

      const backlinks = await getBacklinks(fullNotePath, req.user!.id);
      res.json(backlinks);
    } catch (err) {
      console.error("Error fetching backlinks:", err);
      res.status(500).json({ error: "Failed to fetch backlinks" });
    }
  });

  return router;
}
