import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ValidationError } from "../../../lib/errors.js";
import {
  trashDeleteResponseSchema,
  trashEmptyResponseSchema,
  trashListResponseSchema,
  trashRestoreResponseSchema,
  trashWildcardParamsSchema,
} from "../schemas/trash.schemas.js";

function decodePathParam(raw: string): string {
  return decodeURIComponent(raw);
}

export interface TrashRoutesDeps {
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Trash routes — mounted at `/api/trash`. All filesystem + DB work is
 * delegated to `app.trash` (TrashApi). MCP tools call the same API
 * directly, so behaviour can't diverge.
 *
 * URL summary:
 *   GET    /api/trash                       list trashed notes
 *   POST   /api/trash/restore/:path*        restore a note from trash
 *   DELETE /api/trash/:path*                permanently delete one note
 */
export function trashRoutes(deps: TrashRoutesDeps): FastifyPluginAsync {
  const { ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "List all trashed notes",
          response: { 200: trashListResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        return app.trash.list(user.id);
      },
    );

    typed.post(
      "/restore/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Restore a note from trash",
          params: trashWildcardParamsSchema,
          response: { 200: trashRestoreResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");
        const { path: restoredPath } = await app.trash.restore(ctx.user.id, notePath);
        return { message: "Note restored", path: restoredPath };
      },
    );

    typed.delete(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Permanently delete a note from trash",
          params: trashWildcardParamsSchema,
          response: { 200: trashDeleteResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");
        await app.trash.permanentlyDelete(ctx.user.id, notePath);
        return { message: "Note permanently deleted" };
      },
    );
  };
}

/**
 * Trash-empty routes — mounted at `/api/trash-empty`, separate from the main
 * trash router so the wildcard DELETE route doesn't shadow it.
 *
 * URL summary:
 *   DELETE /api/trash-empty    empty entire trash
 */
export function trashEmptyRoutes(deps: TrashRoutesDeps): FastifyPluginAsync {
  const { ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.delete(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "Empty the entire trash",
          response: { 200: trashEmptyResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        await app.trash.emptyAll(ctx.user.id);
        return { message: "Trash emptied" };
      },
    );
  };
}
