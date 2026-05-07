import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createApiKeyBodySchema,
  apiKeyIdParamsSchema,
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
} from "../schemas/api-key.schemas.js";
import type { ApiKeyService } from "../services/api-key.service.js";

interface ApiKeysRoutesDeps {
  apiKeyService: ApiKeyService;
}

/**
 * API key routes — mounted under `/api/api-keys`. All routes are session-only
 * (cannot be called using an API key bearer token).
 */
export const apiKeysRoutes = (deps: ApiKeysRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { apiKeyService } = deps;

    typed.post(
      "/",
      {
        schema: {
          tags: ["identity"],
          summary: "Create a new API key",
          body: createApiKeyBodySchema,
          response: { 201: createApiKeyResponseSchema },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireSession(ctx);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        const { name, scope, expiresAt } = req.body;
        const result = await apiKeyService.create(
          ctx.user.id,
          name,
          scope,
          expiresAt ? new Date(expiresAt) : null,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      "/",
      {
        schema: {
          tags: ["identity"],
          summary: "List API keys for the current user",
          response: { 200: listApiKeysResponseSchema },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireSession(ctx);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        return apiKeyService.list(ctx.user.id);
      },
    );

    typed.delete(
      "/:id",
      {
        schema: {
          tags: ["identity"],
          summary: "Revoke an API key",
          params: apiKeyIdParamsSchema,
          response: { 204: z.null() },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireSession(ctx);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        await apiKeyService.revoke(ctx.user.id, req.params.id);
        reply.status(204);
        return null;
      },
    );
  };
