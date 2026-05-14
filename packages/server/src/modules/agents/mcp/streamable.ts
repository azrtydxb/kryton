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
import { McpSessionStore } from "./session-store.js";
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
  const store = new McpSessionStore(app);

  const countForUser = async (userId: string): Promise<number> => {
    // Memory + DB are the same set after the rehydrate-on-miss path,
    // but immediately post-boot the DB knows about more sessions than
    // memory does. Use the DB as the source of truth for cap checks.
    return store.countForUser(userId);
  };

  /** Drop a session locally (memory + active-sessions registry). */
  const closeLocal = async (sid: string): Promise<void> => {
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

  /** Drop a session locally and from the DB (explicit DELETE / idle reap). */
  const closeSession = async (sid: string): Promise<void> => {
    await closeLocal(sid);
    await store.delete(sid).catch(() => undefined);
  };

  /**
   * Rebuild a SessionEntry from a persisted row + the fresh bearer the
   * client just supplied. The SDK transport normally only flips
   * `_initialized=true` after handshaking an `initialize`. Post-restart
   * we already negotiated, so we poke those two private fields directly
   * — the alternative is forcing the client to re-init, which is the
   * exact thing this persistence path exists to avoid.
   */
  const rehydrate = (args: {
    sid: string;
    userId: string;
    rawKey: string;
    keyScope: "read-only" | "read-write";
  }): SessionEntry => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => args.sid,
    });
    // SDK internals — see comment above. Confined to this one call site.
    interface InternalTransport {
      _webStandardTransport: { sessionId: string; _initialized: boolean };
    }
    const internal = transport as unknown as InternalTransport;
    internal._webStandardTransport.sessionId = args.sid;
    internal._webStandardTransport._initialized = true;

    const mcpServer = buildMcpServer({
      app,
      userId: args.userId,
      keyScope: args.keyScope,
      rawKey: args.rawKey,
    });
    void mcpServer.connect(transport);

    const entry: SessionEntry = {
      transport,
      userId: args.userId,
      mcpServer,
      lastActivity: Date.now(),
    };
    sessions.set(args.sid, entry);
    activeSessions.register({
      sessionId: args.sid,
      userId: args.userId,
      transport: "streamable",
      startedAt: Date.now(),
      lastActivity: Date.now(),
    });
    transport.onclose = (): void => {
      sessions.delete(args.sid);
      activeSessions.unregister(args.sid);
    };
    return entry;
  };

  const reaper = setInterval(() => {
    // Memory sweep — drop entries idle past the in-process cutoff.
    const cutoff = Date.now() - IDLE_TIMEOUT_MS;
    for (const [sid, s] of [...sessions.entries()]) {
      if (s.lastActivity < cutoff) {
        log.info(`mcp-streamable: idle session reaped (user=${s.userId})`);
        void closeSession(sid);
      }
    }
    // DB sweep — covers persisted rows that no live process is tracking
    // (e.g., after a restart where some sessions were never touched).
    void store.reapIdle(IDLE_TIMEOUT_MS).catch(() => undefined);
  }, REAP_INTERVAL_MS);
  reaper.unref();

  app.addHook("onClose", async () => {
    clearInterval(reaper);
    // Close local transports cleanly on shutdown but DO NOT delete the
    // DB rows — that's the whole point. Clients reconnecting after
    // restart find their session in the store and resume.
    for (const sid of [...sessions.keys()]) await closeLocal(sid);
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/",
    schema: { hide: true },
    handler: async (request, reply) => {
      const auth = await authenticateMcpRequest(app, request, reply);
      if (!auth) return;

      const sid = readSessionId(request);

      // Live in-memory session — reuse its transport.
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
        void store.touch(sid).catch(() => undefined);
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

      // sid supplied but not in memory — try the persisted store before
      // giving up. This is the path that survives a Kryton restart:
      // the row is still in McpSession, so we rebuild the transport +
      // McpServer in-process and the client doesn't notice the bounce.
      if (sid) {
        const persisted = await store.findValid(sid, auth.rawKey, IDLE_TIMEOUT_MS);
        if (persisted && persisted.userId === auth.userId) {
          if (request.method === "DELETE") {
            await closeSession(sid);
            void reply.status(204).send();
            return;
          }
          const entry = rehydrate({
            sid,
            userId: persisted.userId,
            rawKey: auth.rawKey,
            keyScope: persisted.keyScope,
          });
          await store.touch(sid).catch(() => undefined);
          reply.hijack();
          try {
            await entry.transport.handleRequest(request.raw, reply.raw, request.body);
          } catch (err) {
            log.error("rehydrated transport.handleRequest error:", err);
            if (!reply.raw.headersSent) reply.raw.statusCode = 500;
            reply.raw.end();
          }
          return;
        }
        // Genuinely unknown / expired / wrong-bearer — 404 per spec so
        // compliant clients re-init.
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

      if ((await countForUser(auth.userId)) >= MAX_SESSIONS_PER_USER) {
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
      // Persist so the session survives a Kryton restart.
      await store
        .upsert({
          id: newId,
          userId: auth.userId,
          rawKey: auth.rawKey,
          keyScope: auth.scope,
        })
        .catch((err) => log.warn("mcp session persist failed", err));

      transport.onclose = (): void => {
        sessions.delete(newId);
        activeSessions.unregister(newId);
        void store.delete(newId).catch(() => undefined);
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
