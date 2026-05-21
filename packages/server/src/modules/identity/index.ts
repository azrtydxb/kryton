import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { ApiKeyService } from "./services/api-key.service.js";
import { usersRoutes } from "./routes/users.routes.js";
import { apiKeysRoutes } from "./routes/api-keys.routes.js";
import { pushRoutes } from "./routes/push.routes.js";

const identityModuleImpl: FastifyPluginAsync = async (app) => {
  const apiKeyService = new ApiKeyService(app);

  if (!app.hasDecorator("identity")) {
    app.decorate("identity", { apiKey: apiKeyService });
  }

  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(apiKeysRoutes({ apiKeyService }), { prefix: "/api/api-keys" });
  await app.register(pushRoutes, { prefix: "/api/push" });
};

/**
 * Identity module — users, API keys, and auth helpers.
 *
 * Note: Better Auth catch-all (`/api/auth/*`) is mounted by `plugins/auth.ts`,
 * not here. This module owns the user-facing identity REST surface.
 *
 * Wrapped with `fastify-plugin` so `app.identity.apiKey` is visible to
 * siblings (notably `plugins/auth.ts` for API-key validation).
 */
export const identityModule: FastifyPluginAsync = fp(identityModuleImpl, {
  name: "identity-module",
});
