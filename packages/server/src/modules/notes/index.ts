import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { backfillFolders } from "./services/backfill/folders-backfill.js";
import { backfillSearchIndex } from "./services/backfill/search-index-backfill.js";
import { backfillTags } from "./services/backfill/tags-backfill.js";
import { ensureNotesWatcher, stopAllNotesWatchers } from "./services/notes-watcher.js";
import { NoteService } from "./services/note.service.js";
import { TrashApi } from "./services/trash.service.js";
import { FoldersApi } from "./services/folders.service.js";
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
    trash: TrashApi;
    folders: FoldersApi;
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
// Wrapped with `fastify-plugin` so `app.notes` is visible to sibling
// modules (knowledge, collab, agents/MCP). Without this, the decorator
// stays encapsulated in the notes scope and downstream callers see
// `Cannot read properties of undefined (reading 'scanDirectory')`.
const notesModuleImpl: FastifyPluginAsync = async (app) => {
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

  if (!app.hasDecorator("trash")) {
    app.decorate("trash", new TrashApi(app, notesDir));
  }
  if (!app.hasDecorator("folders")) {
    app.decorate("folders", new FoldersApi(notesDir, noteService));
  }

  // Per-process backfill tracking. Mirrors the Express server's
  // `backfilledUsers` Set so a user's folders/tags only get backfilled once.
  const backfilledUsers = new Set<string>();
  const ensureBackfilled = async (userId: string): Promise<void> => {
    if (backfilledUsers.has(userId)) return;
    backfilledUsers.add(userId);
    try {
      await backfillFolders(app, notesDir, userId);
      // Reconcile SearchIndex + GraphEdge against disk. This replaces the
      // initial-scan side of the MiniSearch reconcile module that was
      // deleted in the Postgres migration (Phase 6 / PR #109). Without this,
      // any .md file present on disk before chokidar starts watching never
      // gets indexed because the watcher runs with `ignoreInitial: true`.
      await backfillSearchIndex(app, notesDir, userId);
      await backfillTags(app, userId);
      // Start a live chokidar watcher so out-of-band changes (filesystem rm,
      // Finder, git checkout) keep the index in sync without the user having
      // to restart the server. The chokidar `ready` event reconciles the
      // index by emitting add/unlink for any drift on disk.
      await ensureNotesWatcher(app, notesDir, userId);
    } catch (err) {
      // Non-fatal: log and allow retry on the next request.
      app.log.warn({ err, userId }, "backfill failed for user");
      backfilledUsers.delete(userId);
    }
  };

  const deps = { notesDir, noteService, ensureBackfilled };

  // Warm-start watchers + reconcile for every existing user dir at boot so
  // out-of-band changes (filesystem rm, git checkout, manual edit) are
  // picked up without requiring the user to send a request first. Without
  // this, a file dropped on disk before the user reloads the UI would sit
  // unindexed until ensureBackfilled fires on their first authenticated call.
  app.addHook("onReady", async () => {
    try {
      const fs = await import("node:fs/promises");
      let entries: { name: string; isDirectory: () => boolean }[];
      try {
        entries = await fs.readdir(notesDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        // Schedule but don't block onReady — backfill+reconcile can be slow.
        void ensureBackfilled(entry.name);
      }
    } catch (err) {
      app.log.warn({ err }, "warm-start watchers failed");
    }
  });

  // Register the shutdown hook once at module init. ensureNotesWatcher used
  // to call addHook per-user inside its body, which fails with
  // FST_ERR_INSTANCE_ALREADY_LISTENING the moment a request triggers the
  // lazy-init path after `app.ready()` has resolved.
  app.addHook("onClose", async () => {
    await stopAllNotesWatchers();
  });

  // Mount shared-notes BEFORE /api/notes so the prefix is matched first.
  await app.register(sharedNotesRoutes(deps), { prefix: "/api/notes/shared" });
  await app.register(notesRoutes(deps), { prefix: "/api/notes" });
  await app.register(notesRenameRoutes(deps), { prefix: "/api/notes-rename" });

  await app.register(foldersRoutes({ ensureBackfilled }), {
    prefix: "/api/folders",
  });
  await app.register(foldersRenameRoutes({ ensureBackfilled }), {
    prefix: "/api/folders-rename",
  });

  await app.register(dailyRoutes(deps), { prefix: "/api/daily" });
  await app.register(templatesRoutes({ notesDir, ensureBackfilled }), {
    prefix: "/api/templates",
  });
  await app.register(tagsRoutes({ ensureBackfilled }), { prefix: "/api/tags" });

  // Trash-empty must register before trash to avoid wildcard conflicts.
  await app.register(trashEmptyRoutes({ ensureBackfilled }), {
    prefix: "/api/trash-empty",
  });
  await app.register(trashRoutes({ ensureBackfilled }), {
    prefix: "/api/trash",
  });

  // Aux routes (attachments, canvas, history, backlinks) — owned by notes-aux
  await registerAuxRoutes(app);
};

export const notesModule: FastifyPluginAsync = fp(notesModuleImpl, {
  name: "notes-module",
});
