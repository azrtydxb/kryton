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
}

/**
 * Folder CRUD routes — mounted at `/api/folders`.
 *
 * URL summary:
 *   POST   /api/folders                create folder (filesystem)
 *   DELETE /api/folders/:path*         delete an empty folder
 */
export function foldersRoutes(deps: FoldersRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled } = deps;

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
          summary: "Delete an empty folder",
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

        const entries = await fs.readdir(fullPath);
        if (entries.length > 0) {
          throw new ValidationError("Folder is not empty");
        }

        await fs.rmdir(fullPath);
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
