import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ValidationError, ForbiddenError } from "../../../lib/errors.js";
import { settings } from "../../../db/schema/settings.js";

const updateSettingSchema = z.object({
  value: z.string(),
});

const settingsRecordResponseSchema = z.record(z.string(), z.string());

const updateSettingResponseSchema = z.object({
  key: z.string(),
  value: z.string(),
  message: z.string(),
});

const settingKeyParamsSchema = z.object({ key: z.string() });

const ADMIN_ONLY_KEYS = new Set<string>(["registration_mode"]);

/**
 * Per-user settings routes — mounted under /api/settings.
 */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/",
    {
      schema: {
        tags: ["platform"],
        summary: "Get current user's settings",
        response: { 200: settingsRecordResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const userSettings = await app.db.query.settings.findMany({
        where: eq(settings.userId, user.id),
      });

      const result: Record<string, string> = {};
      for (const setting of userSettings) {
        result[setting.key] = setting.value;
      }
      return result;
    },
  );

  typed.put(
    "/:key",
    {
      schema: {
        tags: ["platform"],
        summary: "Update a per-user setting",
        params: settingKeyParamsSchema,
        body: updateSettingSchema,
        response: { 200: updateSettingResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const key = req.params.key;

      if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key)) {
        throw new ValidationError("Invalid setting key format");
      }

      if (ADMIN_ONLY_KEYS.has(key)) {
        throw new ForbiddenError("This setting requires admin access");
      }

      const { value } = req.body;

      await app.db
        .insert(settings)
        .values({ key, userId: user.id, value })
        .onConflictDoUpdate({
          target: [settings.key, settings.userId],
          set: { value, updatedAt: new Date() },
        });

      return { key, value, message: "Setting updated" };
    },
  );
};
