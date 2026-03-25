import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

/**
 * @swagger
 * /users/search:
 *   get:
 *     summary: Search for a user by email
 *     description: Find a user by exact email match. Returns public profile info only.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact email address to search for
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *       400:
 *         description: Email query parameter is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
export function createUsersRouter(): Router {
  const router = Router();

  // GET /api/users/search — Search user by email
  router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.query.email as string | undefined;

      if (!email) {
        res.status(400).json({ error: "email query parameter is required" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ id: user.id, name: user.name, email: user.email });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
