import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  notesByTagResponseSchema,
  tagListResponseSchema,
  tagParamsSchema,
} from "../schemas/tags.schemas.js";

export interface TagsRoutesDeps {
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Tags routes — mounted at `/api/tags`. The actual tag/notes-by-tag queries
 * live in the `knowledge` module; we delegate via `app.knowledge`.
 *
 * URL summary:
 *   GET /api/tags                 list tags with counts
 *   GET /api/tags/:tag/notes      list notes containing a tag
 */
export function tagsRoutes(deps: TagsRoutesDeps): FastifyPluginAsync {
  const { ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "List all tags with counts",
          response: { 200: tagListResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        return (await app.knowledge?.getAllTags(user.id)) ?? [];
      },
    );

    typed.get(
      "/:tag/notes",
      {
        schema: {
          tags: ["notes"],
          summary: "List notes with a specific tag",
          params: tagParamsSchema,
          response: { 200: notesByTagResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const { tag } = req.params;
        return (await app.knowledge?.getNotesByTag(tag, user.id)) ?? [];
      },
    );
  };
}
