import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

/**
 * Plugin event broadcast channel. Listens on `/ws/plugins`, requires an
 * authenticated session, and exposes `broadcast(event, data)` for the
 * plugin manager to push lifecycle / domain events to subscribed clients.
 *
 * Replaces the legacy `ws` server-based PluginWebSocket. Now built on
 * `@fastify/websocket` (which is registered globally by the host).
 */
export class PluginWebSocket {
  private clients = new Set<WebSocket>();

  constructor(app: FastifyInstance) {
    app.route({
      method: "GET",
      url: "/ws/plugins",
      schema: { tags: ["plugins"], hide: true },
      websocket: true,
      preValidation: async (req, reply) => {
        try {
          const ctx = await app.auth.resolve(req);
          if (!ctx) {
            reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "plugin ws auth failed" } });
            return;
          }
        } catch {
          reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "plugin ws auth failed" } });
        }
      },
      handler: (socket) => {
        this.clients.add(socket as unknown as WebSocket);
        (socket as unknown as WebSocket).on("close", () => {
          this.clients.delete(socket as unknown as WebSocket);
        });
        (socket as unknown as WebSocket).on("error", (err: unknown) => {
          app.log.error({ err }, "plugin ws client error");
          this.clients.delete(socket as unknown as WebSocket);
        });
      },
    });

    app.log.info("Plugin WebSocket route registered at /ws/plugins");
  }

  broadcast(event: string, data: object): void {
    const payload = JSON.stringify({ event, data });
    for (const client of this.clients) {
      try {
        // 1 = OPEN per ws spec
        if ((client as unknown as { readyState: number }).readyState === 1) {
          client.send(payload);
        }
      } catch {
        // ignore failed sends
      }
    }
  }

  close(): void {
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}
