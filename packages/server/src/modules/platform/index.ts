import type { FastifyPluginAsync } from "fastify";
import { versionRoutes } from "./routes/version.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { adminUsersRoutes } from "./routes/admin-users.routes.js";
import { adminInvitesRoutes } from "./routes/admin-invites.routes.js";
import { adminSettingsRoutes } from "./routes/admin-settings.routes.js";
import { settingsRoutes } from "./routes/settings.routes.js";

/**
 * Platform module — health, version, admin, settings.
 *
 * Top-level operational endpoints (`/version`, `/healthz`, `/readyz`) are
 * registered without a prefix. Admin endpoints mount under `/api/admin` and
 * per-user settings under `/api/settings` to preserve the Express paths.
 */
export const platformModule: FastifyPluginAsync = async (app) => {
  await app.register(versionRoutes);
  await app.register(healthRoutes);

  await app.register(
    async (scope) => {
      await scope.register(adminUsersRoutes);
      await scope.register(adminInvitesRoutes);
      await scope.register(adminSettingsRoutes);
    },
    { prefix: "/api/admin" },
  );

  await app.register(settingsRoutes, { prefix: "/api/settings" });
};
