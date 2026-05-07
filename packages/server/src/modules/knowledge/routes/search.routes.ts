import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  searchQuerySchema,
  searchResponseSchema,
} from "../schemas/search.schemas.js";
import type { SearchService } from "../services/search.service.js";

export interface SearchRoutesOptions {
  searchService: SearchService;
}

/**
 * Search routes — mounted under `/api/search`. The search service is passed in
 * so the handlers don't depend on the (optional, parallel-migration) decorator
 * shape of `app.knowledge`.
 */
export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (
  app,
  opts,
) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Search notes",
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const { q } = req.query;
      return opts.searchService.search(q.trim(), user.id);
    },
  );
};
