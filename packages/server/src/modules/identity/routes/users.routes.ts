import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { NotFoundError } from "../../../lib/errors.js";
import { user } from "../../../db/schema/auth.js";
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

      const found = await app.db.query.user.findFirst({
        where: eq(user.email, email),
      });
      if (!found) {
        throw new NotFoundError("User not found");
      }

      return { id: found.id, name: found.name, email: found.email };
    },
  );
};
