import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { APP_VERSION, APP_COMMIT, APP_MAJOR_VERSION } from "../../../lib/version.js";

const versionResponseSchema = z.object({
  version: z.string(),
  commit: z.string(),
  major: z.number().int(),
});

export const versionRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/version",
    {
      schema: {
        tags: ["platform"],
        summary: "Server version and build info",
        response: { 200: versionResponseSchema },
      },
    },
    async () => ({
      version: APP_VERSION,
      commit: APP_COMMIT,
      major: APP_MAJOR_VERSION,
    }),
  );
};
