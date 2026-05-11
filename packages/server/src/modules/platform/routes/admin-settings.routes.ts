import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { GLOBAL_USER_ID } from "../../../lib/pathUtils.js";
import { settings } from "../../../db/schema/settings.js";

const registrationModeSchema = z.object({
  mode: z.enum(["open", "invite-only"]),
});

const registrationModeResponseSchema = z.object({
  mode: z.string(),
});

/**
 * Admin global-settings routes — mounted under /api/admin.
 */
export const adminSettingsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/settings/registration",
    {
      schema: {
        tags: ["platform"],
        summary: "Get registration mode (admin)",
        response: { 200: registrationModeResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async () => {
      const rows = await app.db.query.settings.findMany({
        where: eq(settings.key, "registration_mode"),
      });
      const row = rows.find((r) => r.userId === GLOBAL_USER_ID) ?? rows[0];
      const mode = row?.value ?? "open";
      return { mode };
    },
  );

  typed.put(
    "/settings/registration",
    {
      schema: {
        tags: ["platform"],
        summary: "Update registration mode (admin)",
        body: registrationModeSchema,
        response: { 200: registrationModeResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const { mode } = req.body;
      await app.db
        .insert(settings)
        .values({ key: "registration_mode", userId: GLOBAL_USER_ID, value: mode })
        .onConflictDoUpdate({
          target: [settings.key, settings.userId],
          set: { value: mode, updatedAt: new Date() },
        });
      return { mode };
    },
  );
};
