/**
 * MCP-over-SSE transport (legacy 2024-11-05 spec).
 *
 *   GET  /api/mcp/sse                — opens the event stream, returns sessionId
 *   POST /api/mcp/messages?sessionId — sends JSON-RPC requests on that session
 *
 * Per-user concurrent-session cap + idle reaper. Older MCP clients
 * (early Claude Desktop, mcp-remote with --transport sse) speak this;
 * newer clients use the Streamable HTTP transport.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { buildMcpServer } from "./build-server.js";
import { authenticateMcpRequest } from "./auth.js";
import { createLogger } from "../../../lib/logger.js";

const log = createLogger("mcp-sse");

const MAX_SESSIONS_PER_USER = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;
const DEFAULT_KEEPALIVE_MS = 25_000;

interface SseSessionEntry {
  transport: SSEServerTransport;
  userId: string;
  mcpServer: ReturnType<typeof buildMcpServer>;
  lastActivity: number;
  keepalive: NodeJS.Timeout;
}

function resolveKeepaliveMs(): number {
  const raw = Number(process.env.KRYTON_SSE_KEEPALIVE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KEEPALIVE_MS;
}

function readSessionIdFromQuery(req: FastifyRequest): string | undefined {
  const q = req.query as { sessionId?: unknown };
  return typeof q?.sessionId === "string" && q.sessionId.length > 0 ? q.sessionId : undefined;
}

export const sseMcpRoutes: FastifyPluginAsync = async (app) => {
  const sessions = new Map<string, SseSessionEntry>();

  const countForUser = (userId: string): number => {
    let n = 0;
    for (const s of sessions.values()) if (s.userId === userId) n += 1;
    return n;
  };

  const closeSession = async (sid: string): Promise<void> => {
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    clearInterval(s.keepalive);
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
        log.info(`mcp-sse: idle session reaped (user=${s.userId})`);
        void closeSession(sid);
      }
    }
  }, REAP_INTERVAL_MS);
  reaper.unref();

  app.addHook("onClose", async () => {
    clearInterval(reaper);
    for (const sid of [...sessions.keys()]) await closeSession(sid);
  });

  // GET /sse — open SSE stream, returns sessionId via the SDK transport.
  app.route({
    method: "GET",
    url: "/sse",
    schema: { hide: true },
    handler: async (request, reply) => {
      const auth = await authenticateMcpRequest(app, request, reply);
      if (!auth) return;

      if (countForUser(auth.userId) >= MAX_SESSIONS_PER_USER) {
        void reply.status(429).send({
          error: `Too many MCP sessions (max ${MAX_SESSIONS_PER_USER} per user)`,
        });
        return;
      }

      reply.hijack();
      // SSE transport's first arg is the message-post path it tells the
      // client to use for outbound JSON-RPC. Client constructs:
      //   POST <messagesPath>?sessionId=<id>
      const transport = new SSEServerTransport("/api/mcp/messages", reply.raw);
      const mcpServer = buildMcpServer({
        app,
        userId: auth.userId,
        keyScope: auth.scope,
        rawKey: auth.rawKey,
      });
      await mcpServer.connect(transport);

      const sessionId = transport.sessionId;
      const keepaliveMs = resolveKeepaliveMs();
      const keepalive = setInterval(() => {
        try {
          reply.raw.write(": ping\n\n");
        } catch {
          /* connection closed */
        }
      }, keepaliveMs);
      keepalive.unref();

      const entry: SseSessionEntry = {
        transport,
        userId: auth.userId,
        mcpServer,
        lastActivity: Date.now(),
        keepalive,
      };
      sessions.set(sessionId, entry);

      const teardown = (): void => {
        void closeSession(sessionId);
      };
      reply.raw.on("close", teardown);
      reply.raw.on("error", teardown);
    },
  });

  // POST /messages?sessionId=… — JSON-RPC for an existing session.
  app.route({
    method: "POST",
    url: "/messages",
    schema: { hide: true },
    handler: async (request, reply) => {
      const auth = await authenticateMcpRequest(app, request, reply);
      if (!auth) return;

      const sid = readSessionIdFromQuery(request);
      if (!sid) {
        void reply.status(400).send({ error: "sessionId query parameter required" });
        return;
      }
      const entry = sessions.get(sid);
      if (!entry) {
        void reply.status(404).send({ error: "session not found" });
        return;
      }
      if (entry.userId !== auth.userId) {
        void reply.status(403).send({ error: "Session belongs to a different user" });
        return;
      }
      entry.lastActivity = Date.now();

      reply.hijack();
      try {
        await entry.transport.handlePostMessage(request.raw, reply.raw, request.body);
      } catch (err) {
        log.error("handlePostMessage error:", err);
        if (!reply.raw.headersSent) reply.raw.statusCode = 500;
        reply.raw.end();
      }
    },
  });
};
