import { Router, Request, Response } from "express";
import { getFullGraph } from "../services/graphService";

export function createGraphRouter(): Router {
  const router = Router();

  // GET /api/graph — Return all nodes and edges for the graph view
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const graph = await getFullGraph();
      res.json(graph);
    } catch (err) {
      console.error("Error fetching graph data:", err);
      res.status(500).json({ error: "Failed to fetch graph data" });
    }
  });

  return router;
}
