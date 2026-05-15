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
import { decodePathParam } from "../../../lib/pathUtils.js";

export interface FoldersRoutesDeps {
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Folder CRUD routes — mounted at `/api/folders`. Filesystem + path-
 * safety logic lives in `app.folders` (FoldersApi) so the MCP tool
 * executors (create_folder / rename_folder / delete_folder) call the
 * same code path.
 *
 * URL summary:
 *   POST   /api/folders                create folder
 *   DELETE /api/folders/:path*         delete a folder (recursively
 *                                      trashes any notes inside)
 */
export function foldersRoutes(deps: FoldersRoutesDeps): FastifyPluginAsync {
  const { ensureBackfilled } = deps;

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
        const folderPath = req.body.path ?? req.body.name!;
        const { path } = await app.folders.create(ctx.user.id, folderPath);
        reply.status(201);
        return { path, message: "Folder created" };
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
        const folderPath = decodePathParam(req.params["*"]);
        if (!folderPath) throw new ValidationError("Path is required");
        await app.folders.delete(ctx.user.id, folderPath);
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
  const { ensureBackfilled } = deps;

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
        const oldPath = decodePathParam(req.params["*"]);
        if (!oldPath) throw new ValidationError("Path is required");
        const { newPath } = req.body;
        const result = await app.folders.rename(ctx.user.id, oldPath, newPath);
        return { oldPath: result.oldPath, newPath: result.newPath, message: "Folder renamed" };
      },
    );
  };
}
