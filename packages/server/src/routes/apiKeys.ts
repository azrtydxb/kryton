import { Router, Request, Response, NextFunction } from "express";
import { requireUser, requireSession } from "../middleware/auth.js";
import { validate, createApiKeySchema } from "../lib/validation.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/apiKeyService.js";

/**
 * @swagger
 * tags:
 *   - name: API Keys
 *     description: Manage API keys for programmatic access
 */
export function createApiKeysRouter(): Router {
  const router = Router();

  /**
   * @swagger
   * /api-keys:
   *   post:
   *     summary: Create a new API key
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, scope]
   *             properties:
   *               name:
   *                 type: string
   *                 maxLength: 100
   *               scope:
   *                 type: string
   *                 enum: [read-only, read-write]
   *               expiresAt:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       201:
   *         description: API key created (full key returned only once)
   *       400:
   *         description: Validation error or key limit exceeded
   *       403:
   *         description: Session-only endpoint
   */
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      const parsed = validate(createApiKeySchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const { name, scope, expiresAt } = parsed.data;
      const result = await createApiKey(
        user.id,
        name,
        scope,
        expiresAt ? new Date(expiresAt) : null,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api-keys:
   *   get:
   *     summary: List all API keys for the current user
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of API keys (without secret values)
   *       403:
   *         description: Session-only endpoint
   */
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      const keys = await listApiKeys(user.id);
      res.json(keys);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api-keys/{id}:
   *   delete:
   *     summary: Revoke an API key
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: API key revoked
   *       404:
   *         description: API key not found
   *       403:
   *         description: Session-only endpoint
   */
  router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      await revokeApiKey(user.id, req.params.id as string);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
