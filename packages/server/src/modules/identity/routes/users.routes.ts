import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { NotFoundError } from "../../../lib/errors.js";
import {
  userSearchQuerySchema,
  userPublicProfileSchema,
} from "../schemas/users.schemas.js";

/**
 * User routes — mounted under `/api/users`.
 * GET /search — find a user by exact email match.
 */
export const usersRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/search",
    {
      schema: {
        tags: ["identity"],
        summary: "Search for a user by email",
        querystring: userSearchQuerySchema,
        response: { 200: userPublicProfileSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const { email } = req.query;

      const user = await app.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      return { id: user.id, name: user.name, email: user.email };
    },
  );
};
