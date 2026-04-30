import { Router, Request, Response, NextFunction } from "express";
import { getBacklinks } from "../services/graphService";
import { requireUser } from "../middleware/auth.js";
import { decodePathParam, ensureExtension } from "../lib/pathUtils.js";
import { ValidationError } from "../lib/errors.js";

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
 *                     example: Projects/Kryton Roadmap.md
 *                   title:
 *                     type: string
 *                     example: Kryton Roadmap
 *       400:
 *         description: Path is required
 *       500:
 *         description: Failed to fetch backlinks
 */
export function createBacklinksRouter(): Router {
  const router = Router();

  // GET /api/backlinks/:path(*) — Get notes that link TO this note
  router.get("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const fullNotePath = ensureExtension(notePath, ".md");
      const backlinks = await getBacklinks(fullNotePath, user.id);
      res.json(backlinks);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
