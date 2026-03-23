import { Router, Request, Response } from "express";
import {
  scanDirectory,
  readNote,
  writeNote,
  deleteNote,
  renameNote,
} from "../services/noteService";

/**
 * @swagger
 * /notes:
 *   get:
 *     summary: List all notes
 *     description: Returns a tree structure of all notes in the notes directory.
 *     tags: [Notes]
 *     responses:
 *       200:
 *         description: File tree of notes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Failed to scan notes directory
 */
/**
 * @swagger
 * /notes/{path}:
 *   get:
 *     summary: Get note content
 *     description: Retrieves the content of a single note by its path. Automatically appends .md if not present.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path to the note (e.g., "Projects/Mnemo Roadmap")
 *     responses:
 *       200:
 *         description: Note content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                   example: Projects/Mnemo Roadmap.md
 *                 content:
 *                   type: string
 *                   example: "# Mnemo Roadmap\n..."
 *       400:
 *         description: Path is required or invalid
 *       404:
 *         description: Note not found
 *       500:
 *         description: Failed to read note
 */
/**
 * @swagger
 * /notes:
 *   post:
 *     summary: Create a new note
 *     description: Creates a new markdown note at the specified path.
 *     tags: [Notes]
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
 *                 description: Relative path for the new note
 *                 example: Ideas/New Idea
 *               content:
 *                 type: string
 *                 description: Markdown content of the note
 *                 example: "# New Idea\n\nSome content here."
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                   example: Ideas/New Idea.md
 *                 message:
 *                   type: string
 *                   example: Note created
 *       400:
 *         description: Path is required or invalid
 *       500:
 *         description: Failed to create note
 */
/**
 * @swagger
 * /notes/{path}:
 *   put:
 *     summary: Update a note
 *     description: Updates the content of an existing note.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path to the note
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: New markdown content
 *     responses:
 *       200:
 *         description: Note updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: Note updated
 *       400:
 *         description: Path or content is required
 *       500:
 *         description: Failed to update note
 *   delete:
 *     summary: Delete a note
 *     description: Deletes a note by its path.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path to the note
 *     responses:
 *       200:
 *         description: Note deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Note deleted
 *       400:
 *         description: Path is required or invalid
 *       404:
 *         description: Note not found
 *       500:
 *         description: Failed to delete note
 */
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

  // GET /api/notes/:path(*) — Get note content (path is wildcard to support slashes)
  router.get("/{*path}", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
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

  // PUT /api/notes/:path(*) — Update a note
  router.put("/{*path}", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
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

  // DELETE /api/notes/:path(*) — Delete a note
  router.delete("/{*path}", async (req: Request, res: Response) => {
    try {
      const notePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
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
 * @swagger
 * /notes-rename/{path}:
 *   post:
 *     summary: Rename a note
 *     description: Renames a note from one path to another.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Current relative path of the note
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
 *                 description: New path for the note
 *                 example: Projects/Renamed Note
 *     responses:
 *       200:
 *         description: Note renamed
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
 *                   example: Note renamed
 *       400:
 *         description: Path or newPath is required
 *       404:
 *         description: Note not found
 *       500:
 *         description: Failed to rename note
 */
/**
 * Separate router for the rename endpoint, mounted at /api/notes-rename
 * to avoid conflict with the wildcard routes.
 */
export function createNotesRenameRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/notes-rename/:path(*) — Rename a note
  router.post("/{*path}", async (req: Request, res: Response) => {
    try {
      const oldPath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
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
