/**
 * MCP-over-Streamable-HTTP transport (modern 2025-03-26 spec).
 *
 *   POST   /api/mcp   — JSON-RPC; new sessions on `initialize`
 *   GET    /api/mcp   — server→client SSE channel for an existing session
 *   DELETE /api/mcp   — terminates a session
 *
 * Sessions are tracked by `Mcp-Session-Id` header. Each session owns its
 * own McpServer instance. Per-user concurrency cap + idle reaper bound
 * resource use.
 */
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./build-server.js";
import { authenticateMcpRequest } from "./auth.js";
import * as activeSessions from "./active-sessions.js";
import { createLogger } from "../../../lib/logger.js";

const log = createLogger("mcp-streamable");

const MAX_SESSIONS_PER_USER = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  userId: string;
  mcpServer: ReturnType<typeof buildMcpServer>;
  lastActivity: number;
}

function readSessionId(req: FastifyRequest): string | undefined {
  const v = req.headers["mcp-session-id"];
  return Array.isArray(v) ? v[0] : v;
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const m = (body as { method?: unknown }).method;
  return m === "initialize";
}

/**
 * The MCP `initialize` JSON-RPC payload looks like:
 *   { method: "initialize", params: { clientInfo: { name, version }, ... } }
 * Extract name/version so we can surface "Claude Desktop", "Cursor", etc. in
 * the sidebar — falling back to `undefined` for anonymous/older clients.
 */
function extractClientInfo(body: unknown): { name?: string; version?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const info = (params as { clientInfo?: unknown }).clientInfo;
  if (!info || typeof info !== "object" || Array.isArray(info)) return {};
  const { name, version } = info as { name?: unknown; version?: unknown };
  return {
    name: typeof name === "string" ? name : undefined,
    version: typeof version === "string" ? version : undefined,
  };
}
function extractClientName(body: unknown): string | undefined {
  return extractClientInfo(body).name;
}
function extractClientVersion(body: unknown): string | undefined {
  return extractClientInfo(body).version;
}

export const streamableMcpRoutes: FastifyPluginAsync = async (app) => {
  const sessions = new Map<string, SessionEntry>();

  const countForUser = (userId: string): number => {
    let n = 0;
    for (const s of sessions.values()) if (s.userId === userId) n += 1;
    return n;
  };

  const closeSession = async (sid: string): Promise<void> => {
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    activeSessions.unregister(sid);
    try {
      await s.transport.close();
    } catch {
      // best-effort
    }
    try {
      await s.mcpServer.close();
    } catch {
      // best-effort
    }
  };

  const reaper = setInterval(() => {
    const cutoff = Date.now() - IDLE_TIMEOUT_MS;
    for (const [sid, s] of [...sessions.entries()]) {
      if (s.lastActivity < cutoff) {
        log.info(`mcp-streamable: idle session reaped (user=${s.userId})`);
        void closeSession(sid);
      }
    }
  }, REAP_INTERVAL_MS);
  reaper.unref();

  app.addHook("onClose", async () => {
    clearInterval(reaper);
    for (const sid of [...sessions.keys()]) await closeSession(sid);
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/",
    schema: { hide: true },
    handler: async (request, reply) => {
      const auth = await authenticateMcpRequest(app, request, reply);
      if (!auth) return;

      const sid = readSessionId(request);

      // Existing session — reuse its transport.
      if (sid && sessions.has(sid)) {
        const entry = sessions.get(sid)!;
        if (entry.userId !== auth.userId) {
          void reply.status(403).send({ error: "Session belongs to a different user" });
          return;
        }
        if (request.method === "DELETE") {
          await closeSession(sid);
          void reply.status(204).send();
          return;
        }
        entry.lastActivity = Date.now();
        activeSessions.touch(sid);
        reply.hijack();
        try {
          await entry.transport.handleRequest(request.raw, reply.raw, request.body);
        } catch (err) {
          log.error("transport.handleRequest error:", err);
          if (!reply.raw.headersSent) reply.raw.statusCode = 500;
          reply.raw.end();
        }
        return;
      }

      // No live session for the supplied id. Two cases worth distinguishing:
      //   1. Client sent an Mcp-Session-Id we don't know (expired, or
      //      the server was restarted and the in-memory map was wiped).
      //      Per the MCP streamable-HTTP transport spec we MUST return
      //      404 here — that's the signal compliant clients use to
      //      transparently re-issue an `initialize` and reconnect.
      //   2. Client sent no Mcp-Session-Id at all and isn't sending
      //      `initialize`. That's a genuine protocol violation → 400.
      if (sid) {
        void reply.status(404).send({
          error: "MCP session not found or expired; re-initialize to obtain a new session id",
        });
        return;
      }
      if (request.method !== "POST" || !isInitializeRequest(request.body)) {
        void reply.status(400).send({
          error: "Missing or invalid Mcp-Session-Id header (initialize required to create a session)",
        });
        return;
      }

      if (countForUser(auth.userId) >= MAX_SESSIONS_PER_USER) {
        void reply.status(429).send({
          error: `Too many MCP sessions (max ${MAX_SESSIONS_PER_USER} per user)`,
        });
        return;
      }

      const newId = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newId,
      });
      const mcpServer = buildMcpServer({
        app,
        userId: auth.userId,
        keyScope: auth.scope,
        rawKey: auth.rawKey,
      });
      await mcpServer.connect(transport);

      const entry: SessionEntry = {
        transport,
        userId: auth.userId,
        mcpServer,
        lastActivity: Date.now(),
      };
      sessions.set(newId, entry);
      activeSessions.register({
        sessionId: newId,
        userId: auth.userId,
        transport: "streamable",
        clientName: extractClientName(request.body),
        clientVersion: extractClientVersion(request.body),
        startedAt: Date.now(),
        lastActivity: Date.now(),
      });

      transport.onclose = (): void => {
        sessions.delete(newId);
        activeSessions.unregister(newId);
      };

      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (err) {
        log.error("initialize transport error:", err);
        await closeSession(newId);
        if (!reply.raw.headersSent) reply.raw.statusCode = 500;
        reply.raw.end();
      }
    },
  });
};
