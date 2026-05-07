import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ValidationError } from "../../../lib/errors.js";
import {
  createFolderBodySchema,
  folderCreatedResponseSchema,
  folderDeletedResponseSchema,
  folderRenamedResponseSchema,
  renameFolderBodySchema,
} from "../schemas/folders.schemas.js";
import { wildcardPathParamsSchema } from "../schemas/notes.schemas.js";
import type { NoteService } from "../services/note.service.js";
import { getUserNotesDir } from "../services/user-notes-dir.service.js";

function decodePathParam(raw: string): string {
  return decodeURIComponent(raw);
}
function validatePathWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new ValidationError("Invalid path: outside allowed directory");
  }
}

export interface FoldersRoutesDeps {
  notesDir: string;
  ensureBackfilled: (userId: string) => Promise<void>;
  /** Optional — when present, folder DELETE recursively trashes notes
   *  inside the folder before removing the directory. */
  noteService?: NoteService;
}

/** Walk a directory and yield every .md file path RELATIVE to baseDir. */
async function collectMarkdownFiles(
  baseDir: string,
  relPath: string,
): Promise<string[]> {
  const out: string[] = [];
  const fullPath = path.join(baseDir, relPath);
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdownFiles(baseDir, childRel)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Folder CRUD routes — mounted at `/api/folders`.
 *
 * URL summary:
 *   POST   /api/folders                create folder (filesystem)
 *   DELETE /api/folders/:path*         delete an empty folder
 */
export function foldersRoutes(deps: FoldersRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled, noteService } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "Create a folder",
          body: createFolderBodySchema,
          response: { 201: folderCreatedResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);

        const folderPath = req.body.path ?? req.body.name!;
        const fullPath = path.join(userDir, folderPath);
        validatePathWithinBase(fullPath, userDir);

        await fs.mkdir(fullPath, { recursive: true });
        reply.status(201);
        return { path: folderPath, message: "Folder created" };
      },
    );

    typed.delete(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Delete a folder (recursively trashes any notes inside)",
          params: wildcardPathParamsSchema,
          response: { 200: folderDeletedResponseSchema },
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
        const folderPath = decodePathParam(req.params["*"]);
        if (!folderPath) throw new ValidationError("Path is required");

        const fullPath = path.join(userDir, folderPath);
        validatePathWithinBase(fullPath, userDir);

        // Trash every .md file inside (recursively) so the user can
        // restore individual notes from trash, then remove the now-
        // empty directory tree. Non-md files (if any) are dropped.
        if (noteService) {
          const markdownFiles = await collectMarkdownFiles(userDir, folderPath);
          for (const relPath of markdownFiles) {
            await noteService.deleteNote(userDir, relPath, ctx.user.id);
          }
        }

        // Remove the directory tree (any leftover non-md files + empty
        // sub-directories). `force: true` makes this a no-op if the
        // directory was already cleaned up.
        await fs.rm(fullPath, { recursive: true, force: true });
        return { message: "Folder deleted" };
      },
    );
  };
}

/**
 * Folder rename routes — mounted at `/api/folders-rename`.
 *
 * URL summary:
 *   POST /api/folders-rename/:path*    rename a folder
 */
export function foldersRenameRoutes(deps: FoldersRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Rename a folder",
          params: wildcardPathParamsSchema,
          body: renameFolderBodySchema,
          response: { 200: folderRenamedResponseSchema },
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
        const folderPath = decodePathParam(req.params["*"]);
        if (!folderPath) throw new ValidationError("Path is required");

        const { newPath } = req.body;
        const oldFullPath = path.join(userDir, folderPath);
        const newFullPath = path.join(userDir, newPath);
        validatePathWithinBase(oldFullPath, userDir);
        validatePathWithinBase(newFullPath, userDir);

        await fs.mkdir(path.dirname(newFullPath), { recursive: true });
        await fs.rename(oldFullPath, newFullPath);

        return { oldPath: folderPath, newPath, message: "Folder renamed" };
      },
    );
  };
}
