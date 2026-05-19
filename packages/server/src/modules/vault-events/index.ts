import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import fp from "fastify-plugin";
import { z } from "zod";
import { extractWsToken } from "../../lib/ws-auth.js";
import type { VaultEvent, VaultEventOrigin } from "./types.js";

/**
 * Extract the originating client id from a Fastify request's
 * `X-Kryton-Client-Id` header. Browser tabs that opened a `/ws/vault`
 * socket send this on every mutating HTTP request so the server can
 * suppress the echo back to the originator.
 */
export function originFromRequest(
  req: FastifyRequest,
  auth: { agentId: string | null; agentName?: string | null } | null,
): VaultEventOrigin {
  const raw = req.headers["x-kryton-client-id"];
  const clientId = typeof raw === "string" && raw.length > 0 ? raw.slice(0, 128) : null;
  return {
    clientId,
    agentId: auth?.agentId ?? null,
    agentName: auth?.agentName ?? null,
  };
}

/**
 * Per-user push channel for tree-level changes (note/folder/tag mutations).
 *
 * The server pushes a `VaultEvent` to every WS connected for the affected
 * `userId`, skipping the socket whose `clientId` originated the change so
 * the originator doesn't re-process its own optimistic update.
 *
 * Authentication mirrors `/ws/yjs/:docId`:
 *   - Sec-WebSocket-Protocol "kryton-token,<token>" for agent bearer auth.
 *   - Otherwise cookie/session resolution.
 *
 * The originating client's stable id arrives as `?clientId=<uuid>`;
 * sessionStorage on the browser keeps it stable across reloads of the
 * same tab.
 */

/**
 * Minimal contract a socket must satisfy to be registered. Kept narrow
 * so the test suite can plug in a fake without importing `ws` types.
 */
export interface BroadcastSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
}

interface VaultSocket {
  socket: BroadcastSocket;
  clientId: string | null;
}

interface AuthInfo {
  userId: string;
  agentId: string | null;
}

export interface VaultEventsApi {
  /**
   * Broadcast a `VaultEvent` to every connected socket belonging to
   * `userId` whose `clientId` differs from `event.clientId`.
   * Returns the number of sockets the event was delivered to.
   */
  emit(userId: string, event: VaultEvent): number;
  /** Number of sockets currently open for a given user (test helper). */
  socketCount(userId: string): number;
  /**
   * Register a socket under a user id. Returns a disposer that removes
   * the socket from the registry. Exposed primarily so the WS route
   * handler and the test suite share one path.
   */
  register(userId: string, socket: BroadcastSocket, clientId: string | null): () => void;
}

declare module "fastify" {
  interface FastifyInstance {
    vaultEvents?: VaultEventsApi;
  }
}

const queryStringSchema = z.object({
  clientId: z.string().min(1).max(128).optional(),
});

/**
 * Build the per-user registry. Extracted from the plugin so unit tests
 * can exercise the emit/register paths without booting Fastify.
 *
 * `onSendError` is invoked when a `socket.send` throws so the plugin
 * can route the failure through the app log; tests pass a no-op.
 */
export function createVaultEventsRegistry(opts?: {
  onSendError?: (err: unknown, userId: string) => void;
}): VaultEventsApi {
  const byUser = new Map<string, Set<VaultSocket>>();
  const onSendError = opts?.onSendError;
  return {
    emit(userId, event) {
      const sockets = byUser.get(userId);
      if (!sockets || sockets.size === 0) return 0;
      const payload = JSON.stringify(event);
      let delivered = 0;
      for (const entry of sockets) {
        if (event.clientId && entry.clientId === event.clientId) continue;
        if (entry.socket.readyState !== entry.socket.OPEN) continue;
        try {
          entry.socket.send(payload);
          delivered += 1;
        } catch (err) {
          onSendError?.(err, userId);
        }
      }
      return delivered;
    },
    socketCount(userId) {
      return byUser.get(userId)?.size ?? 0;
    },
    register(userId, socket, clientId) {
      const entry: VaultSocket = { socket, clientId };
      let set = byUser.get(userId);
      if (!set) {
        set = new Set();
        byUser.set(userId, set);
      }
      set.add(entry);
      return () => {
        const current = byUser.get(userId);
        if (!current) return;
        current.delete(entry);
        if (current.size === 0) byUser.delete(userId);
      };
    },
  };
}

const vaultEventsModuleImpl: FastifyPluginAsync = async (app) => {
  const api = createVaultEventsRegistry({
    onSendError: (err, userId) => {
      app.log.warn(
        { err: err instanceof Error ? err.message : String(err), userId },
        "vault-events send failed",
      );
    },
  });

  app.decorate("vaultEvents", api);

  // Mount the WS route in an encapsulated child plugin so the websocket
  // route handler can be attached without leaking to other routes.
  await app.register(async (childApp) => {
    childApp.route({
      method: "GET",
      url: "/ws/vault",
      schema: {
        tags: ["vault-events"],
        hide: true,
        querystring: queryStringSchema,
      },
      websocket: true,
      preValidation: async (req, reply) => {
        const token = extractWsToken(req);
        if (token) {
          const result = await app.auth.authenticateWsToken(token);
          if (result) {
            (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth = result;
            return;
          }
        }
        const ctx = await app.auth.resolve(req).catch(() => null);
        if (ctx) {
          (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth = {
            userId: ctx.user.id,
            agentId: ctx.agentId,
          };
          return;
        }
        reply
          .code(401)
          .send({ error: { code: "UNAUTHENTICATED", message: "Vault events WS auth failed" } });
      },
      handler: ((socket: WebSocket, req: FastifyRequest) => {
        const auth = (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth;
        if (!auth) {
          socket.close(1008, "unauthenticated");
          return;
        }
        const query = req.query as { clientId?: string } | undefined;
        const clientId = query?.clientId ?? null;

        const dispose = api.register(auth.userId, socket, clientId);

        socket.on("close", () => {
          dispose();
        });

        socket.on("error", (err) => {
          app.log.warn(
            { err: err instanceof Error ? err.message : String(err), userId: auth.userId },
            "vault-events ws error",
          );
        });
      }) as never,
    });
  });
};

export const vaultEventsModule: FastifyPluginAsync = fp(vaultEventsModuleImpl, {
  name: "vault-events-module",
});
