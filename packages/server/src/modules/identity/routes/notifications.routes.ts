import type { FastifyPluginAsync } from "fastify";
import { notificationBus, type NotificationEvent } from "../services/notifications/bus.js";

/**
 * Notification SSE stream route.
 *
 * GET /api/notifications/stream — streams NotificationEvent objects as
 * server-sent events for the authenticated user. Events are formatted as:
 *
 *   event: notification
 *   data: <JSON>
 *
 * A `: ping` comment is written every 25 seconds to keep proxies from
 * idle-closing the connection.
 */
export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/notifications/stream", async (req, reply) => {
    const { user } = await app.auth.requireAuth(req);
    const userId = user.id;

    // Take over the response lifecycle: we stream via reply.raw and never let
    // Fastify serialize/send a payload. Without hijack() Fastify would attempt
    // to send a response when this handler resolves ("Reply was already sent").
    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (event: NotificationEvent) => {
      reply.raw.write(`event: notification\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsub = notificationBus.subscribe(userId, write);

    // Heartbeat every 25 s to keep proxies from idle-closing the connection.
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    const close = () => {
      clearInterval(heartbeat);
      unsub();
      reply.raw.end();
    };

    req.raw.on("close", close);
    req.raw.on("error", close);
  });
};
