import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { backfillFolders } from "./services/backfill/folders-backfill.js";
import { backfillTags } from "./services/backfill/tags-backfill.js";
import { reconcileSearchIndex } from "./services/backfill/search-index-reconcile.js";
import { NoteService } from "./services/note.service.js";
import { getUserNotesDir } from "./services/user-notes-dir.service.js";
import {
  notesRenameRoutes,
  notesRoutes,
  sharedNotesRoutes,
} from "./routes/notes.routes.js";
import { foldersRenameRoutes, foldersRoutes } from "./routes/folders.routes.js";
import { dailyRoutes } from "./routes/daily.routes.js";
import { templatesRoutes } from "./routes/templates.routes.js";
import { tagsRoutes } from "./routes/tags.routes.js";
import { trashEmptyRoutes, trashRoutes } from "./routes/trash.routes.js";
import { registerAuxRoutes } from "./aux-routes.js";

/**
 * Surface exposed to other modules via `app.notes`.
 *
 * Downstream modules (collab, knowledge) need to know where a user's notes
 * live on disk; they call `getUserNotesDir(userId)` rather than computing the
 * path themselves so the layout stays encapsulated here.
 */
export interface NotesApi {
  /** Path to the per-user notes directory. Creates it on first call. */
  getUserNotesDir(userId: string): Promise<string>;
  /** Read a note's content + metadata. */
  readNote(userPath: string, userId: string): Promise<{ content: string; modifiedAt: Date | string | null }>;
  /** Write (create or update) a note. */
  writeNote(userPath: string, content: string, userId: string): Promise<void>;
  /** Delete a note (move to trash). */
  deleteNote(userPath: string, userId: string): Promise<void>;
  /** Scan the user's note tree. */
  scanDirectory(userId: string): Promise<unknown[]>;
}

declare module "fastify" {
  interface FastifyInstance {
    notes: NotesApi;
  }
}

/**
 * Notes module — owns the on-disk note tree, folder/tag/trash CRUD, daily
 * notes and templates. Mounts under `/api/notes`, `/api/notes-rename`,
 * `/api/folders`, `/api/folders-rename`, `/api/daily`, `/api/templates`,
 * `/api/tags`, `/api/trash`, and `/api/trash-empty` to preserve current
 * client-facing URLs.
 *
 * Backfill (folders + tags) runs once per (process, user) — preserved from the
 * Express server's `ensureBackfilled` middleware. Triggered via per-route
 * `preHandler` after authentication so we know the user id.
 */
export const notesModule: FastifyPluginAsync = async (app) => {
  const notesDir = path.resolve(
    app.config.NOTES_DIR.startsWith("/")
      ? app.config.NOTES_DIR
      : path.join(process.cwd(), app.config.NOTES_DIR),
  );

  const noteService = new NoteService(app);

  // Decorate so other modules can resolve a user's notes dir.
  if (!app.hasDecorator("notes")) {
    const api: NotesApi = {
      getUserNotesDir: (userId) => getUserNotesDir(notesDir, userId),
      async readNote(userPath, userId) {
        const dir = await getUserNotesDir(notesDir, userId);
        const data = await noteService.readNote(dir, userPath);
        return { content: data.content, modifiedAt: data.modifiedAt ?? null };
      },
      async writeNote(userPath, content, userId) {
        const dir = await getUserNotesDir(notesDir, userId);
        await noteService.writeNote(dir, userPath, content, userId);
      },
      async deleteNote(userPath, userId) {
        const dir = await getUserNotesDir(notesDir, userId);
        await noteService.deleteNote(dir, userPath, userId);
      },
      async scanDirectory(userId) {
        const dir = await getUserNotesDir(notesDir, userId);
        return noteService.scanDirectory(dir);
      },
    };
    app.decorate("notes", api);
  }

  // Per-process backfill tracking. Mirrors the Express server's
  // `backfilledUsers` Set so a user's folders/tags only get backfilled once.
  const backfilledUsers = new Set<string>();
  const ensureBackfilled = async (userId: string): Promise<void> => {
    if (backfilledUsers.has(userId)) return;
    backfilledUsers.add(userId);
    try {
      await backfillFolders(app, notesDir, userId);
      await backfillTags(app, userId);
      // Drop searchIndex/graphEdge rows for notes that no longer exist on
      // disk — keeps the graph view from rendering phantom nodes when the
      // notes dir was rebased, the user deleted files out-of-band, or a
      // dev worktree points at a different notes root.
      await reconcileSearchIndex(app, notesDir, userId);
    } catch (err) {
      // Non-fatal: log and allow retry on the next request.
      app.log.warn({ err, userId }, "backfill failed for user");
      backfilledUsers.delete(userId);
    }
  };

  const deps = { notesDir, noteService, ensureBackfilled };

  // Mount shared-notes BEFORE /api/notes so the prefix is matched first.
  await app.register(sharedNotesRoutes(deps), { prefix: "/api/notes/shared" });
  await app.register(notesRoutes(deps), { prefix: "/api/notes" });
  await app.register(notesRenameRoutes(deps), { prefix: "/api/notes-rename" });

  await app.register(foldersRoutes({ notesDir, ensureBackfilled, noteService }), {
    prefix: "/api/folders",
  });
  await app.register(foldersRenameRoutes({ notesDir, ensureBackfilled }), {
    prefix: "/api/folders-rename",
  });

  await app.register(dailyRoutes(deps), { prefix: "/api/daily" });
  await app.register(templatesRoutes({ notesDir, ensureBackfilled }), {
    prefix: "/api/templates",
  });
  await app.register(tagsRoutes({ ensureBackfilled }), { prefix: "/api/tags" });

  // Trash-empty must register before trash to avoid wildcard conflicts.
  await app.register(trashEmptyRoutes({ notesDir, ensureBackfilled }), {
    prefix: "/api/trash-empty",
  });
  await app.register(trashRoutes({ notesDir, ensureBackfilled }), {
    prefix: "/api/trash",
  });

  // Aux routes (attachments, canvas, history, backlinks) — owned by notes-aux
  await registerAuxRoutes(app);
};
