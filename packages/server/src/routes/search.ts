import { Router, Request, Response } from "express";
import { search } from "../services/searchService";

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
