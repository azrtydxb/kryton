/**
 * Admin REST endpoints for the tunnel module.
 *
 * Mounted under /api/admin/tunnel/*. All endpoints gated by
 * `app.auth.requireAdmin`. See spec 4c §4.
 */
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { sanityCheck, truncateForDisplay } from "../utils/jwt.js";
import {
  setTokenSchema,
  statsQuerySchema,
  tunnelStatsSchema,
  tunnelStatusSchema,
} from "../types.js";

const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export const adminTunnelRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/tunnel/status",
    {
      schema: {
        tags: ["platform"],
        summary: "Get tunnel status (admin)",
        response: { 200: tunnelStatusSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async () => app.tunnel.client.getStatus(),
  );

  typed.post(
    "/tunnel/token",
    {
      schema: {
        tags: ["platform"],
        summary: "Set the tunnel JWT (admin)",
        body: setTokenSchema,
        response: {
          200: tunnelStatusSchema,
          400: errorSchema,
        },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req, reply) => {
      const { token } = req.body;
      const check = sanityCheck(token);
      if (!check.ok) {
        reply.status(400);
        return { error: check.code, message: check.message };
      }
      await app.tunnel.state.setJwt(token);
      await app.tunnel.state.setCachedClaims(check.claims);
      await app.tunnel.state.clearLastError();
      await app.tunnel.client.restart(token);
      app.log.info(
        {
          subdomain: check.claims.subdomain,
          jti: check.claims.jti,
          truncated: truncateForDisplay(token),
        },
        "tunnel token set by admin",
      );
      return app.tunnel.client.getStatus();
    },
  );

  typed.delete(
    "/tunnel/token",
    {
      schema: {
        tags: ["platform"],
        summary: "Clear the tunnel JWT (admin)",
        response: { 204: z.null() },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (_req, reply) => {
      await app.tunnel.client.stop({ timeoutMs: 5_000 });
      await app.tunnel.state.clearJwt();
      app.log.info("tunnel token cleared by admin");
      reply.status(204);
      return null;
    },
  );

  typed.get(
    "/tunnel/stats",
    {
      schema: {
        tags: ["platform"],
        summary: "Get tunnel traffic stats (admin)",
        querystring: statsQuerySchema,
        response: { 200: tunnelStatsSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => app.tunnel.stats.getStats(req.query.window),
  );

  typed.post(
    "/tunnel/reconnect",
    {
      schema: {
        tags: ["platform"],
        summary: "Force a tunnel reconnect attempt (admin)",
        response: { 202: z.object({ accepted: z.boolean() }) },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (_req, reply) => {
      await app.tunnel.client.forceReconnect();
      reply.status(202);
      return { accepted: true };
    },
  );
};
