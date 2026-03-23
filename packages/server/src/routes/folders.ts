import { Router, Request, Response } from "express";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * @swagger
 * /folders:
 *   post:
 *     summary: Create a folder
 *     description: Creates a new folder in the notes directory.
 *     tags: [Folders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - path
 *             properties:
 *               path:
 *                 type: string
 *                 description: Relative path of the folder to create
 *                 example: Projects/NewFolder
 *     responses:
 *       201:
 *         description: Folder created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: Folder created
 *       400:
 *         description: Path is required or invalid
 *       500:
 *         description: Failed to create folder
 */
/**
 * @swagger
 * /folders/{path}:
 *   delete:
 *     summary: Delete an empty folder
 *     description: Deletes a folder only if it is empty.
 *     tags: [Folders]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path of the folder to delete
 *     responses:
 *       200:
 *         description: Folder deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Folder deleted
 *       400:
 *         description: Path is required, invalid, or folder is not empty
 *       404:
 *         description: Folder not found
 *       500:
 *         description: Failed to delete folder
 */
export function createFoldersRouter(notesDir: string): Router {
  const router = Router();

  /**
   * Validate that a resolved path is within the notes directory.
   */
  function validatePath(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    const base = path.resolve(notesDir);
    return resolved.startsWith(base + path.sep) || resolved === base;
  }

  // POST /api/folders — Create a folder
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { path: folderPath } = req.body as { path?: string };
      if (!folderPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const fullPath = path.join(notesDir, folderPath);
      if (!validatePath(fullPath)) {
        res.status(400).json({ error: "Invalid path: outside notes directory" });
        return;
      }

      await fs.mkdir(fullPath, { recursive: true });
      res.status(201).json({ path: folderPath, message: "Folder created" });
    } catch (err) {
      console.error("Error creating folder:", err);
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  // DELETE /api/folders/:path(*) — Delete an empty folder
  router.delete("/{*path}", async (req: Request, res: Response) => {
    try {
      const folderPath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
      if (!folderPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const fullPath = path.join(notesDir, folderPath);
      if (!validatePath(fullPath)) {
        res.status(400).json({ error: "Invalid path: outside notes directory" });
        return;
      }

      // Check if directory is empty
      const entries = await fs.readdir(fullPath);
      if (entries.length > 0) {
        res.status(400).json({ error: "Folder is not empty" });
        return;
      }

      await fs.rmdir(fullPath);
      res.json({ message: "Folder deleted" });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
      console.error("Error deleting folder:", err);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  return router;
}

/**
 * @swagger
 * /folders-rename/{path}:
 *   post:
 *     summary: Rename a folder
 *     description: Renames a folder from one path to another.
 *     tags: [Folders]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Current relative path of the folder
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPath
 *             properties:
 *               newPath:
 *                 type: string
 *                 description: New path for the folder
 *                 example: Projects/RenamedFolder
 *     responses:
 *       200:
 *         description: Folder renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 oldPath:
 *                   type: string
 *                 newPath:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: Folder renamed
 *       400:
 *         description: Path or newPath is required or invalid
 *       404:
 *         description: Folder not found
 *       500:
 *         description: Failed to rename folder
 */
/**
 * Separate router for folder rename to avoid wildcard conflicts.
 */
export function createFoldersRenameRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/folders-rename/:path(*) — Rename a folder
  router.post("/{*path}", async (req: Request, res: Response) => {
    try {
      const folderPath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
      if (!folderPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const { newPath } = req.body as { newPath?: string };
      if (!newPath) {
        res.status(400).json({ error: "newPath is required" });
        return;
      }

      const oldFullPath = path.join(notesDir, folderPath);
      const newFullPath = path.join(notesDir, newPath);

      const resolvedBase = path.resolve(notesDir);
      if (
        !path.resolve(oldFullPath).startsWith(resolvedBase + path.sep) ||
        !path.resolve(newFullPath).startsWith(resolvedBase + path.sep)
      ) {
        res.status(400).json({ error: "Invalid path: outside notes directory" });
        return;
      }

      // Ensure parent of new path exists
      await fs.mkdir(path.dirname(newFullPath), { recursive: true });

      await fs.rename(oldFullPath, newFullPath);
      res.json({ oldPath: folderPath, newPath, message: "Folder renamed" });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
      console.error("Error renaming folder:", err);
      res.status(500).json({ error: "Failed to rename folder" });
    }
  });

  return router;
}
