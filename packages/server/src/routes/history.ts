import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { requireUser, requireScope } from "../middleware/auth.js";
import { decodePathParam } from "../lib/pathUtils.js";
import { ValidationError, NotFoundError } from "../lib/errors.js";
import { writeNote } from "../services/noteService.js";
import { getNoteHistoryDir, saveHistorySnapshot, HISTORY_DIR, MAX_VERSIONS } from "../services/historyService.js";

// Re-export for backward compatibility
export { getNoteHistoryDir, saveHistorySnapshot, HISTORY_DIR, MAX_VERSIONS };

export function createHistoryRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/history/:path(*) — List all versions of a note
  router.get("/{*notePath}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const notePath = decodePathParam(req.params.notePath);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const userDir = await getUserNotesDir(notesDir, user.id);
      const historyDir = getNoteHistoryDir(userDir, notePath);

      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(historyDir, { withFileTypes: true });
      } catch {
        // No history yet
        res.json({ versions: [] });
        return;
      }

      const versions: { timestamp: number; date: string; size: number }[] = [];

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const timestampStr = entry.name.slice(0, -3); // strip .md
        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp)) continue;

        const fullPath = path.join(historyDir, entry.name);
        const stat = await fs.stat(fullPath);

        versions.push({
          timestamp,
          date: new Date(timestamp).toISOString(),
          size: stat.size,
        });
      }

      // Sort newest first
      versions.sort((a, b) => b.timestamp - a.timestamp);

      res.json({ versions });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createHistoryTimestampRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/history-version/:path(*)?ts=:timestamp — Read a specific version
  router.get("/{*notePath}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const notePath = decodePathParam(req.params.notePath);
      const timestamp = parseInt(req.query.ts as string, 10);

      if (!notePath) {
        throw new ValidationError("Path is required");
      }
      if (isNaN(timestamp)) {
        throw new ValidationError("Timestamp query parameter (ts) is required");
      }

      const userDir = await getUserNotesDir(notesDir, user.id);
      const historyDir = getNoteHistoryDir(userDir, notePath);
      const versionFile = path.join(historyDir, `${timestamp}.md`);

      // Security: ensure within history dir
      const resolvedVersion = path.resolve(versionFile);
      const resolvedHistoryDir = path.resolve(historyDir);
      if (!resolvedVersion.startsWith(resolvedHistoryDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      let content: string;
      try {
        content = await fs.readFile(versionFile, "utf-8");
      } catch {
        throw new NotFoundError("Version not found");
      }

      res.json({ content, timestamp, date: new Date(timestamp).toISOString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createHistoryRestoreRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/history-restore/:path(*)?ts=:timestamp — Restore a specific version
  router.post("/{*notePath}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");

      const notePath = decodePathParam(req.params.notePath);
      const timestamp = parseInt(req.query.ts as string, 10);

      if (!notePath) {
        throw new ValidationError("Path is required");
      }
      if (isNaN(timestamp)) {
        throw new ValidationError("Timestamp query parameter (ts) is required");
      }

      const userDir = await getUserNotesDir(notesDir, user.id);
      const historyDir = getNoteHistoryDir(userDir, notePath);
      const versionFile = path.join(historyDir, `${timestamp}.md`);

      // Security: ensure within history dir
      const resolvedVersion = path.resolve(versionFile);
      const resolvedHistoryDir = path.resolve(historyDir);
      if (!resolvedVersion.startsWith(resolvedHistoryDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      let content: string;
      try {
        content = await fs.readFile(versionFile, "utf-8");
      } catch {
        throw new NotFoundError("Version not found");
      }

      // writeNote will save the current content as a new history snapshot first
      await writeNote(userDir, notePath, content, user.id);

      res.json({ restored: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
