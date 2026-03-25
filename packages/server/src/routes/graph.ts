import { Router, Request, Response, NextFunction } from "express";
import { getFullGraph } from "../services/graphService";
import { requireUser } from "../middleware/auth.js";

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
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const graph = await getFullGraph(user.id);
      res.json(graph);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
