import { Router, Request, Response, NextFunction } from "express";
import {
  scanDirectory,
  readNote,
  writeNote,
  deleteNote,
  renameNote,
} from "../services/noteService";
import { getUserNotesDir } from "../services/userNotesDir";
import { hasAccess } from "../services/shareService";
import { validate, createNoteSchema, updateNoteSchema, renameNoteSchema } from "../lib/validation";
import { requireUser, requireScope } from "../middleware/auth.js";
import { decodePathParam, ensureExtension } from "../lib/pathUtils.js";
import { ForbiddenError, ValidationError } from "../lib/errors.js";

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
 *         description: Relative path to the note (e.g., "Projects/Kryton Roadmap")
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
 *                   example: Projects/Kryton Roadmap.md
 *                 content:
 *                   type: string
 *                   example: "# Kryton Roadmap\n..."
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
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const tree = await scanDirectory(userDir);
      res.json(tree);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/notes/:path(*) — Get note content (path is wildcard to support slashes)
  router.get("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const userDir = await getUserNotesDir(notesDir, user.id);
      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const fullNotePath = ensureExtension(notePath, ".md");
      const note = await readNote(userDir, fullNotePath);
      res.json(note);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/notes — Create a new note
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const parsed = validate(createNoteSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { path: notePath, content } = parsed.data;

      const fullNotePath = ensureExtension(notePath, ".md");
      await writeNote(userDir, fullNotePath, content || "", user.id);
      res.status(201).json({ path: fullNotePath, message: "Note created" });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/notes/:path(*) — Update a note
  router.put("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const parsed = validate(updateNoteSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const { content } = parsed.data;

      const fullNotePath = ensureExtension(notePath, ".md");
      await writeNote(userDir, fullNotePath, content, user.id);
      res.json({ path: fullNotePath, message: "Note updated" });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/notes/:path(*) — Delete a note
  router.delete("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const notePath = decodePathParam(req.params.path);
      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const fullNotePath = ensureExtension(notePath, ".md");
      await deleteNote(userDir, fullNotePath, user.id);
      res.json({ message: "Note deleted" });
    } catch (err) {
      next(err);
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
  router.post("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userDir = await getUserNotesDir(notesDir, user.id);
      const oldPath = decodePathParam(req.params.path);
      if (!oldPath) {
        throw new ValidationError("Path is required");
      }

      const parsed = validate(renameNoteSchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const fullOldPath = ensureExtension(oldPath, ".md");
      const fullNewPath = ensureExtension(parsed.data.newPath, ".md");

      await renameNote(userDir, fullOldPath, fullNewPath, user.id);
      res.json({ oldPath: fullOldPath, newPath: fullNewPath, message: "Note renamed" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Router for reading/writing shared notes.
 * Mounted at /api/notes/shared BEFORE the regular /api/notes router
 * to avoid wildcard conflicts.
 */
export function createSharedNotesRouter(notesDir: string): Router {
  const router = Router();

  // GET /api/notes/shared/:ownerUserId/:path(*) — Read a shared note
  router.get("/:ownerUserId/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const ownerUserId = req.params.ownerUserId as string;
      const notePath = decodePathParam(req.params.path);

      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const ownerDir = await getUserNotesDir(notesDir, ownerUserId);
      const fullNotePath = ensureExtension(notePath, ".md");
      const access = await hasAccess(ownerUserId, fullNotePath, user.id);
      if (!access.canRead) {
        throw new ForbiddenError("You do not have permission to read this note");
      }

      const note = await readNote(ownerDir, fullNotePath);
      res.json({ path: fullNotePath, content: note.content, title: note.title });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/notes/shared/:ownerUserId/:path(*) — Write to a shared note
  router.put("/:ownerUserId/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      const ownerUserId = req.params.ownerUserId as string;
      const notePath = decodePathParam(req.params.path);

      if (!notePath) {
        throw new ValidationError("Path is required");
      }

      const ownerDir = await getUserNotesDir(notesDir, ownerUserId);
      const fullNotePath = ensureExtension(notePath, ".md");
      const access = await hasAccess(ownerUserId, fullNotePath, user.id);
      if (!access.canWrite) {
        throw new ForbiddenError("You do not have permission to write to this note");
      }

      const parsedBody = validate(updateNoteSchema, req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: parsedBody.error });
        return;
      }
      const { content } = parsedBody.data;

      await writeNote(ownerDir, fullNotePath, content, ownerUserId);
      res.json({ path: fullNotePath, message: "Note updated" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
