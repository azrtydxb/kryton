import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { graphResponseSchema } from "../schemas/graph.schemas.js";
import type { GraphService } from "../services/graph.service.js";

export interface GraphRoutesOptions {
  graphService: GraphService;
}

/**
 * Graph routes — mounted under `/api/graph`.
 */
export const graphRoutes: FastifyPluginAsync<GraphRoutesOptions> = async (
  app,
  opts,
) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Get knowledge graph",
        response: { 200: graphResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      return opts.graphService.getFullGraph(user.id);
    },
  );
};
