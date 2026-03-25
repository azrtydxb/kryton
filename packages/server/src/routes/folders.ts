import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { getUserNotesDir } from "../services/userNotesDir";
import { validate, createFolderSchema, renameFolderSchema } from "../lib/validation";
import { requireUser, requireScope } from "../middleware/auth.js";
import { decodePathParam, validatePathWithinBase } from "../lib/pathUtils.js";
import { ValidationError } from "../lib/errors.js";

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

  // POST /api/folders — Create a folder
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      // Accept either `path` or `name` for the folder path
      const bodyToValidate = req.body.path
        ? { name: req.body.path as string }
        : req.body;
      const parsed = validate(createFolderSchema, bodyToValidate);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const folderPath = (req.body.path as string | undefined) ?? parsed.data.name;

      const fullPath = path.join(userDir, folderPath);
      validatePathWithinBase(fullPath, userDir);

      await fs.mkdir(fullPath, { recursive: true });
      res.status(201).json({ path: folderPath, message: "Folder created" });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/folders/:path(*) — Delete an empty folder
  router.delete("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const folderPath = decodePathParam(req.params.path);
      if (!folderPath) {
        throw new ValidationError("Path is required");
      }

      const fullPath = path.join(userDir, folderPath);
      validatePathWithinBase(fullPath, userDir);

      // Check if directory is empty
      const entries = await fs.readdir(fullPath);
      if (entries.length > 0) {
        res.status(400).json({ error: "Folder is not empty" });
        return;
      }

      await fs.rmdir(fullPath);
      res.json({ message: "Folder deleted" });
    } catch (err) {
      next(err);
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
  router.post("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const folderPath = decodePathParam(req.params.path);
      if (!folderPath) {
        throw new ValidationError("Path is required");
      }

      const parsed = validate(renameFolderSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { newPath } = parsed.data;

      const oldFullPath = path.join(userDir, folderPath);
      const newFullPath = path.join(userDir, newPath);

      validatePathWithinBase(oldFullPath, userDir);
      validatePathWithinBase(newFullPath, userDir);

      // Ensure parent of new path exists
      await fs.mkdir(path.dirname(newFullPath), { recursive: true });

      await fs.rename(oldFullPath, newFullPath);
      res.json({ oldPath: folderPath, newPath, message: "Folder renamed" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
