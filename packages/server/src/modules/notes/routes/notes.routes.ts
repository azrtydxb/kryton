import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ForbiddenError, ValidationError } from "../../../lib/errors.js";
import {
  createNoteBodySchema,
  fileTreeResponseSchema,
  noteCreatedResponseSchema,
  noteDataResponseSchema,
  noteDeletedResponseSchema,
  noteRenamedResponseSchema,
  noteUpdatedResponseSchema,
  renameNoteBodySchema,
  sharedNoteResponseSchema,
  sharedNotePathParamsSchema,
  updateNoteBodySchema,
  wildcardPathParamsSchema,
} from "../schemas/notes.schemas.js";
import type { NoteService } from "../services/note.service.js";
import { getUserNotesDir } from "../services/user-notes-dir.service.js";
import { decodePathParam, ensureExtension } from "../../../lib/pathUtils.js";

export interface NotesRoutesDeps {
  notesDir: string;
  noteService: NoteService;
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Notes CRUD + listing routes — mounted at `/api/notes`.
 *
 * URL summary:
 *   GET    /api/notes                      list note tree
 *   GET    /api/notes/:path*               read note content
 *   POST   /api/notes                      create note
 *   PUT    /api/notes/:path*               update note
 *   DELETE /api/notes/:path*               soft-delete note (move to trash)
 */
export function notesRoutes(deps: NotesRoutesDeps): FastifyPluginAsync {
  const { notesDir, noteService, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    const requireAuthAndBackfill = async (req: Parameters<typeof app.auth.requireUser>[0]) => {
      const user = await app.auth.requireUser(req);
      await ensureBackfilled(user.id);
      return user;
    };

    typed.get(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "List all notes as a tree",
          response: { 200: fileTreeResponseSchema },
        },
        preHandler: async (req) => {
          await requireAuthAndBackfill(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        return noteService.scanDirectory(userDir);
      },
    );

    typed.get(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Get note content",
          params: wildcardPathParamsSchema,
          response: { 200: noteDataResponseSchema },
        },
        preHandler: async (req) => {
          await requireAuthAndBackfill(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const fullNotePath = ensureExtension(notePath, ".md");
        return noteService.readNote(userDir, fullNotePath);
      },
    );

    typed.post(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "Create a new note",
          body: createNoteBodySchema,
          response: { 201: noteCreatedResponseSchema },
        },
        preHandler: async (req) => {
          await requireAuthAndBackfill(req);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const { path: notePath, content } = req.body;
        const fullNotePath = ensureExtension(notePath, ".md");

        await noteService.writeNote(userDir, fullNotePath, content ?? "", ctx.user.id);
        reply.status(201);
        return { path: fullNotePath, message: "Note created" };
      },
    );

    typed.put(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Update a note",
          params: wildcardPathParamsSchema,
          body: updateNoteBodySchema,
          response: { 200: noteUpdatedResponseSchema },
        },
        preHandler: async (req) => {
          await requireAuthAndBackfill(req);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const fullNotePath = ensureExtension(notePath, ".md");
        await noteService.writeNote(userDir, fullNotePath, req.body.content, ctx.user.id);
        return { path: fullNotePath, message: "Note updated" };
      },
    );

    typed.delete(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Delete a note (move to trash)",
          params: wildcardPathParamsSchema,
          response: { 200: noteDeletedResponseSchema },
        },
        preHandler: async (req) => {
          await requireAuthAndBackfill(req);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const fullNotePath = ensureExtension(notePath, ".md");
        await noteService.deleteNote(userDir, fullNotePath, ctx.user.id);
        return { message: "Note deleted" };
      },
    );
  };
}

/**
 * Notes-rename routes — mounted at `/api/notes-rename` to avoid wildcard
 * conflicts with the main notes router.
 *
 * URL summary:
 *   POST /api/notes-rename/:path*    rename a note
 */
export function notesRenameRoutes(deps: NotesRoutesDeps): FastifyPluginAsync {
  const { notesDir, noteService, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Rename a note",
          params: wildcardPathParamsSchema,
          body: renameNoteBodySchema,
          response: { 200: noteRenamedResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const oldPath = decodePathParam(req.params["*"]);
        if (!oldPath) throw new ValidationError("Path is required");

        const fullOldPath = ensureExtension(oldPath, ".md");
        const fullNewPath = ensureExtension(req.body.newPath, ".md");

        await noteService.renameNote(userDir, fullOldPath, fullNewPath, ctx.user.id);
        return { oldPath: fullOldPath, newPath: fullNewPath, message: "Note renamed" };
      },
    );
  };
}

/**
 * Shared notes router — mounted at `/api/notes/shared` BEFORE the main
 * `/api/notes` router so its prefix isn't shadowed by the wildcard routes.
 *
 * URL summary:
 *   GET /api/notes/shared/:ownerUserId/:path*   read a shared note
 *   PUT /api/notes/shared/:ownerUserId/:path*   write to a shared note
 */
export function sharedNotesRoutes(deps: NotesRoutesDeps): FastifyPluginAsync {
  const { notesDir, noteService, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      "/:ownerUserId/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Read a shared note",
          params: sharedNotePathParamsSchema,
          response: { 200: sharedNoteResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const { ownerUserId } = req.params;
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const ownerDir = await getUserNotesDir(notesDir, ownerUserId);
        const fullNotePath = ensureExtension(notePath, ".md");

        const access = (await app.collab?.hasAccess(ownerUserId, fullNotePath, user.id)) ?? {
          canRead: false,
          canWrite: false,
        };
        if (!access.canRead) {
          throw new ForbiddenError("You do not have permission to read this note");
        }

        const note = await noteService.readNote(ownerDir, fullNotePath);
        return { path: fullNotePath, content: note.content, title: note.title };
      },
    );

    typed.put(
      "/:ownerUserId/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Write to a shared note",
          params: sharedNotePathParamsSchema,
          body: updateNoteBodySchema,
          response: { 200: noteUpdatedResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const { ownerUserId } = req.params;
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const ownerDir = await getUserNotesDir(notesDir, ownerUserId);
        const fullNotePath = ensureExtension(notePath, ".md");

        const access = (await app.collab?.hasAccess(ownerUserId, fullNotePath, user.id)) ?? {
          canRead: false,
          canWrite: false,
        };
        if (!access.canWrite) {
          throw new ForbiddenError("You do not have permission to write to this note");
        }

        await noteService.writeNote(ownerDir, fullNotePath, req.body.content, ownerUserId);
        return { path: fullNotePath, message: "Note updated" };
      },
    );
  };
}
