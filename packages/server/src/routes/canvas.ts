import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { getUserNotesDir } from "../services/userNotesDir";
import { requireUser, requireScope } from "../middleware/auth.js";
import { validatePathWithinBase, ensureExtension } from "../lib/pathUtils.js";
import { validate, createCanvasSchema } from "../lib/validation.js";

/**
 * @swagger
 * /canvas:
 *   get:
 *     summary: List all canvas files
 *     description: Returns a list of all canvas file names (without the .canvas extension).
 *     tags: [Canvas]
 *     responses:
 *       200:
 *         description: List of canvas file names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["my-diagram", "project-plan"]
 *       500:
 *         description: Failed to list canvas files
 *   post:
 *     summary: Create a new canvas file
 *     description: Creates a new canvas file with optional initial content (nodes and edges).
 *     tags: [Canvas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name for the canvas file
 *                 example: my-diagram
 *               content:
 *                 type: object
 *                 description: Initial canvas content with nodes and edges
 *                 properties:
 *                   nodes:
 *                     type: array
 *                     items:
 *                       type: object
 *                   edges:
 *                     type: array
 *                     items:
 *                       type: object
 *     responses:
 *       201:
 *         description: Canvas file created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: my-diagram.canvas
 *                 message:
 *                   type: string
 *                   example: Canvas file created
 *       400:
 *         description: Name is required or invalid path
 *       409:
 *         description: Canvas file already exists
 *       500:
 *         description: Failed to create canvas file
 */
/**
 * @swagger
 * /canvas/{name}:
 *   get:
 *     summary: Get a canvas file
 *     description: Returns the JSON content of a canvas file.
 *     tags: [Canvas]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Canvas file name (without .canvas extension)
 *         example: my-diagram
 *     responses:
 *       200:
 *         description: Canvas file content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodes:
 *                   type: array
 *                   items:
 *                     type: object
 *                 edges:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Name is required or invalid path
 *       404:
 *         description: Canvas file not found
 *       500:
 *         description: Failed to read canvas file
 *   put:
 *     summary: Update a canvas file
 *     description: Replaces the content of a canvas file with the provided JSON body.
 *     tags: [Canvas]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Canvas file name (without .canvas extension)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nodes:
 *                 type: array
 *                 items:
 *                   type: object
 *               edges:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Canvas file updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: Canvas file updated
 *       400:
 *         description: Name or content is required
 *       500:
 *         description: Failed to update canvas file
 *   delete:
 *     summary: Delete a canvas file
 *     description: Deletes a canvas file by name.
 *     tags: [Canvas]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Canvas file name (without .canvas extension)
 *     responses:
 *       200:
 *         description: Canvas file deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Canvas file deleted
 *       400:
 *         description: Name is required or invalid path
 *       404:
 *         description: Canvas file not found
 *       500:
 *         description: Failed to delete canvas file
 */
export function createCanvasRouter(notesDir: string): Router {
  const router = Router();

  /**
   * Ensure the Canvas/ subdirectory exists for the given user directory.
   */
  async function ensureCanvasDir(canvasDir: string): Promise<void> {
    await fs.mkdir(canvasDir, { recursive: true });
  }

  // GET /api/canvas — List all .canvas files
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const canvasDir = path.join(userDir, "Canvas");
      await ensureCanvasDir(canvasDir);
      const entries = await fs.readdir(canvasDir);
      const canvasFiles = entries
        .filter((f) => f.endsWith(".canvas"))
        .map((f) => f.replace(/\.canvas$/, ""));
      res.json(canvasFiles);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/canvas/:name — Get a canvas file content (JSON)
  router.get("/:name", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const name = req.params.name as string;
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      const content = await fs.readFile(filePath, "utf-8");
      res.json(JSON.parse(content));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/canvas — Create a new canvas file
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const canvasDir = path.join(userDir, "Canvas");

      const parsed = validate(createCanvasSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { name, content } = parsed.data;

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      await ensureCanvasDir(canvasDir);

      // Check if file already exists
      try {
        await fs.stat(filePath);
        res.status(409).json({ error: "Canvas file already exists" });
        return;
      } catch {
        // File does not exist — proceed
      }

      const data = content || { nodes: [], edges: [] };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      res.status(201).json({ name: fileName, message: "Canvas file created" });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/canvas/:name — Update a canvas file
  router.put("/:name", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const name = req.params.name as string;
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const body = req.body;
      if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
        res.status(400).json({ error: "Content is required" });
        return;
      }

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      await ensureCanvasDir(canvasDir);
      await fs.writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
      res.json({ name: fileName, message: "Canvas file updated" });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/canvas/:name — Delete a canvas file
  router.delete("/:name", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const name = req.params.name as string;
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      await fs.unlink(filePath);
      res.json({ message: "Canvas file deleted" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
