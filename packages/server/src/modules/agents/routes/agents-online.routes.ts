/**
 * Live MCP-session indicators consumed by the sidebar's "agents online"
 * footer. Two endpoints, both session-authenticated:
 *
 *   GET /api/agents/online        → { count, clients: [{ name, transport, sessionId }] }
 *   GET /api/agents/mcp-health    → { status: "ok" }
 *
 * `mcp-health` is a trivial reachability probe — the MCP module is part of
 * the same Fastify app, so if this route responds the MCP transport plugin
 * is necessarily registered. Surfacing it as its own URL lets the client
 * poll a stable endpoint independent of any specific MCP request shape.
 */
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as activeSessions from "../mcp/active-sessions.js";

const clientSchema = z.object({
  sessionId: z.string(),
  name: z.string().nullable(),
  version: z.string().nullable(),
  transport: z.enum(["sse", "streamable"]),
  startedAt: z.number(),
  lastActivity: z.number(),
});

const onlineSchema = z.object({
  count: z.number().int().nonnegative(),
  clients: z.array(clientSchema),
});

const healthSchema = z.object({
  status: z.literal("ok"),
});

export const agentsOnlineRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/online",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["agents"],
        summary: "List MCP sessions currently connected for the calling user",
        response: { 200: onlineSchema },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const sessions = activeSessions.listForUser(user.id);
      return {
        count: sessions.length,
        clients: sessions.map((s) => ({
          sessionId: s.sessionId,
          name: s.clientName ?? null,
          version: s.clientVersion ?? null,
          transport: s.transport,
          startedAt: s.startedAt,
          lastActivity: s.lastActivity,
        })),
      };
    },
  );

  typed.get(
    "/mcp-health",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["agents"],
        summary: "MCP transport reachability probe",
        response: { 200: healthSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );
};
