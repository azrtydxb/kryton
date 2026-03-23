import { Router, Request, Response } from "express";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Validate that a resolved path stays within the base directory (path traversal protection).
 */
function safePath(baseDir: string, name: string): string {
  const resolved = path.resolve(baseDir, name);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error("Invalid path: path traversal detected");
  }
  return resolved;
}

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
  const canvasDir = path.join(notesDir, "Canvas");

  /**
   * Ensure the Canvas/ subdirectory exists.
   */
  async function ensureCanvasDir(): Promise<void> {
    await fs.mkdir(canvasDir, { recursive: true });
  }

  // GET /api/canvas — List all .canvas files
  router.get("/", async (_req: Request, res: Response) => {
    try {
      await ensureCanvasDir();
      const entries = await fs.readdir(canvasDir);
      const canvasFiles = entries
        .filter((f) => f.endsWith(".canvas"))
        .map((f) => f.replace(/\.canvas$/, ""));
      res.json(canvasFiles);
    } catch (err) {
      console.error("Error listing canvas files:", err);
      res.status(500).json({ error: "Failed to list canvas files" });
    }
  });

  // GET /api/canvas/:name — Get a canvas file content (JSON)
  router.get("/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const fileName = name.endsWith(".canvas") ? name : `${name}.canvas`;
      const filePath = safePath(canvasDir, fileName);

      const content = await fs.readFile(filePath, "utf-8");
      res.json(JSON.parse(content));
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Canvas file not found" });
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error reading canvas file:", err);
      res.status(500).json({ error: "Failed to read canvas file" });
    }
  });

  // POST /api/canvas — Create a new canvas file
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, content } = req.body as { name?: string; content?: unknown };

      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const fileName = name.endsWith(".canvas") ? name : `${name}.canvas`;
      const filePath = safePath(canvasDir, fileName);

      await ensureCanvasDir();

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
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error creating canvas file:", err);
      res.status(500).json({ error: "Failed to create canvas file" });
    }
  });

  // PUT /api/canvas/:name — Update a canvas file
  router.put("/:name", async (req: Request, res: Response) => {
    try {
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

      const fileName = name.endsWith(".canvas") ? name : `${name}.canvas`;
      const filePath = safePath(canvasDir, fileName);

      await ensureCanvasDir();
      await fs.writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
      res.json({ name: fileName, message: "Canvas file updated" });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error updating canvas file:", err);
      res.status(500).json({ error: "Failed to update canvas file" });
    }
  });

  // DELETE /api/canvas/:name — Delete a canvas file
  router.delete("/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const fileName = name.endsWith(".canvas") ? name : `${name}.canvas`;
      const filePath = safePath(canvasDir, fileName);

      await fs.unlink(filePath);
      res.json({ message: "Canvas file deleted" });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Canvas file not found" });
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error deleting canvas file:", err);
      res.status(500).json({ error: "Failed to delete canvas file" });
    }
  });

  return router;
}
