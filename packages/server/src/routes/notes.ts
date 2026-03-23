import { Router, Request, Response } from "express";
import {
  scanDirectory,
  readNote,
  writeNote,
  deleteNote,
  renameNote,
} from "../services/noteService";

export function createNotesRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/notes — List all notes as tree structure
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const tree = await scanDirectory(notesDir);
      res.json(tree);
    } catch (err) {
      console.error("Error scanning notes directory:", err);
      res.status(500).json({ error: "Failed to scan notes directory" });
    }
  });

  // GET /api/notes/:path — Get note content (path is wildcard to support slashes)
  router.get("/*", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(req.params[0]);
      if (!notePath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      // Append .md if not present
      const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;

      const note = await readNote(notesDir, fullNotePath);
      res.json(note);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error reading note:", err);
      res.status(500).json({ error: "Failed to read note" });
    }
  });

  // POST /api/notes — Create a new note
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { path: notePath, content } = req.body as {
        path?: string;
        content?: string;
      };

      if (!notePath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      // Append .md if not present
      const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;

      await writeNote(notesDir, fullNotePath, content || "");
      res.status(201).json({ path: fullNotePath, message: "Note created" });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error creating note:", err);
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  // PUT /api/notes/:path — Update a note
  router.put("/*", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(req.params[0]);
      if (!notePath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const { content } = req.body as { content?: string };
      if (content === undefined) {
        res.status(400).json({ error: "Content is required" });
        return;
      }

      const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;

      await writeNote(notesDir, fullNotePath, content);
      res.json({ path: fullNotePath, message: "Note updated" });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error updating note:", err);
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  // DELETE /api/notes/:path — Delete a note
  router.delete("/*", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(req.params[0]);
      if (!notePath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;

      await deleteNote(notesDir, fullNotePath);
      res.json({ message: "Note deleted" });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error deleting note:", err);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  return router;
}

/**
 * Separate router for the rename endpoint, mounted at /api/notes-rename
 * to avoid conflict with the wildcard routes.
 */
export function createNotesRenameRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/notes-rename/:path — Rename a note
  router.post("/*", async (req: Request, res: Response) => {
    try {
      const oldPath = decodeURIComponent(req.params[0]);
      if (!oldPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }

      const { newPath } = req.body as { newPath?: string };
      if (!newPath) {
        res.status(400).json({ error: "newPath is required" });
        return;
      }

      const fullOldPath = oldPath.endsWith(".md") ? oldPath : `${oldPath}.md`;
      const fullNewPath = newPath.endsWith(".md") ? newPath : `${newPath}.md`;

      await renameNote(notesDir, fullOldPath, fullNewPath);
      res.json({ oldPath: fullOldPath, newPath: fullNewPath, message: "Note renamed" });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("no such file"))
      ) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid path")) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("Error renaming note:", err);
      res.status(500).json({ error: "Failed to rename note" });
    }
  });

  return router;
}
