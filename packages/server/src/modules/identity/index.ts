import type { FastifyPluginAsync } from "fastify";
import { ApiKeyService } from "./services/api-key.service.js";
import { usersRoutes } from "./routes/users.routes.js";
import { apiKeysRoutes } from "./routes/api-keys.routes.js";

/**
 * Identity module — users, API keys, and auth helpers.
 *
 * Note: Better Auth catch-all (`/api/auth/*`) is mounted by `plugins/auth.ts`,
 * not here. This module owns the user-facing identity REST surface.
 */
export const identityModule: FastifyPluginAsync = async (app) => {
  const apiKeyService = new ApiKeyService(app);

  // Decorate so other modules / the auth plugin can use it.
  if (!app.hasDecorator("identity")) {
    app.decorate("identity", { apiKey: apiKeyService });
  }

  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(apiKeysRoutes({ apiKeyService }), { prefix: "/api/api-keys" });
};
