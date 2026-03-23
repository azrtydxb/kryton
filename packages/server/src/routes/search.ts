import { Router, Request, Response } from "express";
import { search } from "../services/searchService";

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Search notes
 *     description: Performs a full-text search across all notes.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query string
 *         example: knowledge management
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   path:
 *                     type: string
 *                     example: Ideas/Knowledge Management.md
 *                   title:
 *                     type: string
 *                     example: Knowledge Management
 *                   snippet:
 *                     type: string
 *                     example: "...notes on building a second brain..."
 *       400:
 *         description: Query parameter 'q' is required
 *       500:
 *         description: Search failed
 */
export function createSearchRouter(): Router {
  const router = Router();

  // GET /api/search?q=query
  router.get("/", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string | undefined;
      if (!query || query.trim().length === 0) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const results = await search(query.trim());
      res.json(results);
    } catch (err) {
      console.error("Error searching notes:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  return router;
}
