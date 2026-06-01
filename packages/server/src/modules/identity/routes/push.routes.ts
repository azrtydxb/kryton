import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { NotFoundError } from "../../../lib/errors.js";
import { registerDevice, deregisterDevice } from "../services/push-devices.js";

const registerBodySchema = z.object({
  platform: z.enum(["ios", "android"]),
  token: z.string().min(1).max(2048),
});

const registerResponseSchema = z.object({
  id: z.string(),
  platform: z.enum(["ios", "android"]),
});

const deviceIdParamsSchema = z.object({
  id: z.string(),
});

/**
 * Push notification device registration routes — mounted under `/api/push`.
 *
 * POST /register    — register (or re-register) a device token
 * DELETE /register/:id — deregister a device by DB id
 */
export const pushRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/register",
    {
      schema: {
        tags: ["push"],
        summary: "Register a push notification device token",
        body: registerBodySchema,
        response: {
          200: registerResponseSchema,
          201: registerResponseSchema,
        },
      },
      preHandler: async (req) => {
        await app.auth.requireAuth(req);
      },
    },
    async (req, reply) => {
      const ctx = await app.auth.requireAuth(req);
      const { platform, token } = req.body;
      const { device, created } = await registerDevice(app.db, {
        userId: ctx.user.id,
        platform,
        token,
      });
      reply.status(created ? 201 : 200);
      return { id: device.id, platform: device.platform as "ios" | "android" };
    },
  );

  typed.delete(
    "/register/:id",
    {
      schema: {
        tags: ["push"],
        summary: "Deregister a push notification device",
        params: deviceIdParamsSchema,
        response: { 204: z.null() },
      },
      preHandler: async (req) => {
        await app.auth.requireAuth(req);
      },
    },
    async (req, reply) => {
      const ctx = await app.auth.requireAuth(req);
      const ok = await deregisterDevice(app.db, { userId: ctx.user.id, id: req.params.id });
      if (!ok) throw new NotFoundError("Device not found");
      reply.status(204);
      return null;
    },
  );
};
