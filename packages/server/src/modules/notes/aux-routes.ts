import type { FastifyInstance } from "fastify";
import { attachmentsRoutes } from "./routes/attachments.routes.js";
import { canvasRoutes } from "./routes/canvas.routes.js";
import { backlinksRoutes } from "./routes/backlinks.routes.js";
import { historyRoutes } from "./routes/history.routes.js";

/**
 * Register the notes "aux" route surface — attachments, canvas, history,
 * backlinks. Owned by the agent-notes-aux team; mounted by the notes-core
 * module's `index.ts` after it has registered the `fastify.notes` decorator.
 *
 * URL paths preserved from the legacy Express server:
 *   /api/attachments
 *   /api/canvas
 *   /api/backlinks
 *   /api/history          (list versions)
 *   /api/history-version  (read a specific version, ?ts=)
 *   /api/history-restore  (restore a specific version, ?ts=)
 */
export async function registerAuxRoutes(app: FastifyInstance): Promise<void> {
  await app.register(attachmentsRoutes, { prefix: "/api/attachments" });
  await app.register(canvasRoutes, { prefix: "/api/canvas" });
  await app.register(backlinksRoutes, { prefix: "/api/backlinks" });

  await app.register(historyRoutes, { prefix: "/api/history", mode: "list" });
  await app.register(historyRoutes, { prefix: "/api/history-version", mode: "version" });
  await app.register(historyRoutes, { prefix: "/api/history-restore", mode: "restore" });
}
