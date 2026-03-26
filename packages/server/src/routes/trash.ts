import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { requireUser, requireScope } from "../middleware/auth.js";
import { decodePathParam, ensureExtension } from "../lib/pathUtils.js";
import { ValidationError, NotFoundError } from "../lib/errors.js";

const TRASH_DIR = ".trash";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrashItem {
  path: string;
  originalPath: string;
  trashedAt: Date;
}

/**
 * Return the trash directory path for a given user notes dir.
 */
export function getTrashDir(userNotesDir: string): string {
  return path.join(userNotesDir, TRASH_DIR);
}

/**
 * Recursively scan a directory and return all .md file paths relative to basePath.
 */
async function scanTrash(dir: string, basePath = ""): Promise<TrashItem[]> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Trash directory doesn't exist yet
    return [];
  }

  const items: TrashItem[] = [];

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await scanTrash(fullPath, relativePath);
      items.push(...children);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stat = await fs.stat(fullPath);
      items.push({
        path: relativePath,
        originalPath: relativePath,
        trashedAt: stat.mtime,
      });
    }
  }

  return items;
}

/**
 * Auto-purge trash items older than 30 days for a user.
 * Called on server startup.
 */
export async function purgeOldTrash(userNotesDir: string): Promise<void> {
  const trashDir = getTrashDir(userNotesDir);
  const items = await scanTrash(trashDir);
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  for (const item of items) {
    if (item.trashedAt.getTime() < cutoff) {
      const fullPath = path.join(trashDir, item.path);
      try {
        await fs.unlink(fullPath);
        // Remove empty parent directories
        await removeEmptyDirs(path.dirname(fullPath), trashDir);
      } catch {
        // Best-effort: ignore errors
      }
    }
  }
}

/**
 * Recursively remove empty directories up to (but not including) stopDir.
 */
async function removeEmptyDirs(dir: string, stopDir: string): Promise<void> {
  if (dir === stopDir || !dir.startsWith(stopDir)) return;
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) {
      await fs.rmdir(dir);
      await removeEmptyDirs(path.dirname(dir), stopDir);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Move a note to the trash directory, preserving its relative path structure.
 */
export async function moveToTrash(userNotesDir: string, notePath: string): Promise<void> {
  const trashDir = getTrashDir(userNotesDir);
  const sourcePath = path.join(userNotesDir, notePath);
  const destPath = path.join(trashDir, notePath);

  // Ensure trash parent directory exists
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  // Use rename (same filesystem)
  await fs.rename(sourcePath, destPath);
}

export function createTrashRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/trash — List all trashed notes
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const trashDir = getTrashDir(userDir);
      const items = await scanTrash(trashDir);
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/trash/restore/:path(*) — Restore a note from trash
  router.post("/restore/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const trashDir = getTrashDir(userDir);

      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const fullNotePath = ensureExtension(notePath, ".md");
      const trashFilePath = path.join(trashDir, fullNotePath);
      const restorePath = path.join(userDir, fullNotePath);

      // Check that trash file path is within trash dir
      const resolvedTrash = path.resolve(trashFilePath);
      const resolvedTrashDir = path.resolve(trashDir);
      if (!resolvedTrash.startsWith(resolvedTrashDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      // Check that restore path is within user dir
      const resolvedRestore = path.resolve(restorePath);
      const resolvedUserDir = path.resolve(userDir);
      if (!resolvedRestore.startsWith(resolvedUserDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      // Verify the file exists in trash
      try {
        await fs.stat(trashFilePath);
      } catch {
        throw new NotFoundError("Note not found in trash");
      }

      // Ensure parent directory exists at restore location
      await fs.mkdir(path.dirname(restorePath), { recursive: true });

      // Move from trash back to original location
      await fs.rename(trashFilePath, restorePath);

      // Clean up empty dirs in trash
      await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

      res.json({ message: "Note restored", path: fullNotePath });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/trash/:path(*) — Permanently delete a single note from trash
  router.delete("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const trashDir = getTrashDir(userDir);

      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const fullNotePath = ensureExtension(notePath, ".md");
      const trashFilePath = path.join(trashDir, fullNotePath);

      // Security: ensure the file is within the trash dir
      const resolvedTrash = path.resolve(trashFilePath);
      const resolvedTrashDir = path.resolve(trashDir);
      if (!resolvedTrash.startsWith(resolvedTrashDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      try {
        await fs.unlink(trashFilePath);
      } catch {
        throw new NotFoundError("Note not found in trash");
      }

      // Clean up empty parent dirs in trash
      await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

      res.json({ message: "Note permanently deleted" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Router for the empty trash endpoint, mounted separately to avoid
 * conflict with the wildcard DELETE /:path route.
 */
export function createTrashEmptyRouter(notesDir: string): Router {
  const router = Router();

  // DELETE /api/trash-empty — Empty the entire trash
  router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const trashDir = getTrashDir(userDir);

      try {
        await fs.rm(trashDir, { recursive: true, force: true });
      } catch {
        // If trash doesn't exist, that's fine
      }

      res.json({ message: "Trash emptied" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
