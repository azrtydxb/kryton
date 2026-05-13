import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Serves the built React client. The Dockerfile copies
 * `packages/client/dist` to `/app/public`; in dev the build output lands
 * at `packages/server/public`. Anything not handled by an /api, /plugins,
 * /docs, /healthz, /readyz, /ws, /version route falls back to index.html
 * so client-side routing works on reload.
 */
export async function spaPlugin(app: FastifyInstance): Promise<void> {
  const candidates = [
    "/app/public",
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "public"),
  ];
  const root = candidates.find((p) => existsSync(join(p, "index.html")));
  if (!root) {
    app.log.warn("SPA bundle not found; web UI will not be served");
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: false,
    decorateReply: false,
  });
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "/";
    if (
      url.startsWith("/api/") ||
      url.startsWith("/plugins/") ||
      url.startsWith("/docs") ||
      url.startsWith("/ws") ||
      url === "/healthz" ||
      url === "/readyz" ||
      url === "/version"
    ) {
      reply.code(404).type("application/json").send({
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
      return;
    }
    reply.sendFile("index.html", root);
  });
  app.log.info({ root }, "SPA bundle wired");
}
