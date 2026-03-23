import { Router, Request, Response } from "express";
import { getFullGraph } from "../services/graphService";

/**
 * @swagger
 * /graph:
 *   get:
 *     summary: Get knowledge graph
 *     description: Returns all nodes and edges for the graph visualization. Nodes represent notes and edges represent wiki-links between them.
 *     tags: [Graph]
 *     responses:
 *       200:
 *         description: Graph data with nodes and edges
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: Welcome.md
 *                       label:
 *                         type: string
 *                         example: Welcome
 *                 edges:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       source:
 *                         type: string
 *                         example: Welcome.md
 *                       target:
 *                         type: string
 *                         example: Projects/Mnemo Roadmap.md
 *       500:
 *         description: Failed to fetch graph data
 */
export function createGraphRouter(): Router {
  const router = Router();

  // GET /api/graph — Return all nodes and edges for the graph view
  router.get("/", async (req: Request, res: Response) => {
    try {
      const graph = await getFullGraph(req.user!.id);
      res.json(graph);
    } catch (err) {
      console.error("Error fetching graph data:", err);
      res.status(500).json({ error: "Failed to fetch graph data" });
    }
  });

  return router;
}
