import { Router, Request, Response } from "express";
import { getAllTags, getNotesByTag } from "../services/searchService";

export function createTagsRouter(): Router {
  const router = Router();

  // GET /api/tags — Get all tags with counts
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const tags = await getAllTags();
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
      const notes = await getNotesByTag(tag);
      res.json(notes);
    } catch (err) {
      console.error("Error fetching notes by tag:", err);
      res.status(500).json({ error: "Failed to fetch notes by tag" });
    }
  });

  return router;
}
