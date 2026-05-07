import type { FastifyPluginAsync } from "fastify";
import { versionRoutes } from "./routes/version.routes.js";
import { healthRoutes } from "./routes/health.routes.js";

/**
 * Platform module — health, version, admin (TBD), settings (TBD).
 * Registered without a URL prefix (these are top-level operational endpoints).
 */
export const platformModule: FastifyPluginAsync = async (app) => {
  await app.register(versionRoutes);
  await app.register(healthRoutes);
};
