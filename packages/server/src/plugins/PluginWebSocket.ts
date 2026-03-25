import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { auth } from "../auth.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("plugin-ws");

export class PluginWebSocket {
  private wss: WebSocketServer;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({
      server,
      path: "/ws/plugins",
      maxPayload: 64 * 1024, // 64KB limit
      verifyClient: async (info, callback) => {
        try {
          const cookieHeader = info.req.headers.cookie;
          if (!cookieHeader) {
            callback(false, 401, "Unauthorized");
            return;
          }

          const session = await auth.api.getSession({
            headers: new Headers({ cookie: cookieHeader }),
          });

          if (!session) {
            callback(false, 401, "Unauthorized");
            return;
          }

          // Check if user account is disabled
          if ((session.user as Record<string, unknown>).disabled) {
            callback(false, 403, "Account is disabled");
            return;
          }

          callback(true);
        } catch {
          callback(false, 401, "Unauthorized");
        }
      },
    });

    this.wss.on("connection", (ws) => {
      ws.on("error", (err) => {
        log.error("Client error:", err);
      });
    });

    log.info("WebSocket server attached at /ws/plugins");
  }

  broadcast(event: string, data: object): void {
    const payload = JSON.stringify({ event, data });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  close(): void {
    this.wss.close();
  }
}
