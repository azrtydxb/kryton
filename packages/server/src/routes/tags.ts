import { Router, Request, Response } from "express";
import { getAllTags, getNotesByTag } from "../services/searchService";

/**
 * @swagger
 * /tags:
 *   get:
 *     summary: Get all tags
 *     description: Returns all tags found across notes with their occurrence counts.
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: List of tags with counts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   tag:
 *                     type: string
 *                     example: project
 *                   count:
 *                     type: integer
 *                     example: 3
 *       500:
 *         description: Failed to fetch tags
 */
/**
 * @swagger
 * /tags/{tag}/notes:
 *   get:
 *     summary: Get notes by tag
 *     description: Returns all notes that contain the specified tag.
 *     tags: [Tags]
 *     parameters:
 *       - in: path
 *         name: tag
 *         required: true
 *         schema:
 *           type: string
 *         description: The tag to filter by (without the # prefix)
 *         example: project
 *     responses:
 *       200:
 *         description: List of notes with the specified tag
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
 *       500:
 *         description: Failed to fetch notes by tag
 */
export function createTagsRouter(): Router {
  const router = Router();

  // GET /api/tags — Get all tags with counts
  router.get("/", async (req: Request, res: Response) => {
    try {
      const tags = await getAllTags(req.user!.id);
      res.json(tags);
    } catch (err) {
      console.error("Error fetching tags:", err);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  // GET /api/tags/:tag/notes — Get notes with a specific tag
  router.get("/:tag/notes", async (req: Request, res: Response) => {
    try {
      const tag = req.params.tag as string;
      const notes = await getNotesByTag(tag, req.user!.id);
      res.json(notes);
    } catch (err) {
      console.error("Error fetching notes by tag:", err);
      res.status(500).json({ error: "Failed to fetch notes by tag" });
    }
  });

  return router;
}
