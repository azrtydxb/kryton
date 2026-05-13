import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "./config/index.js";
import { loggerOptions } from "./plugins/logger.js";
import { zodPlugin } from "./plugins/zod.js";
import { telemetryPlugin } from "./plugins/telemetry.js";
import { securityPlugin } from "./plugins/security.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { dbPlugin } from "./plugins/db.js";
import { embedderPlugin } from "./plugins/embedder.js";
import { cedarPlugin } from "./plugins/cedar.js";
import { authPlugin } from "./plugins/auth.js";
import { errorsPlugin } from "./plugins/errors.js";
import { multipartPlugin } from "./plugins/multipart.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { openapiPlugin } from "./plugins/openapi.js";
import { spaPlugin } from "./plugins/spa.js";

import { platformModule } from "./modules/platform/index.js";
import { identityModule } from "./modules/identity/index.js";
import { notesModule } from "./modules/notes/index.js";
import { knowledgeModule } from "./modules/knowledge/index.js";
import { collabModule } from "./modules/collab/index.js";
import { agentsModule } from "./modules/agents/index.js";
import { pluginsModule } from "./modules/plugins/index.js";
import { tunnelModule } from "./modules/tunnel/index.js";

interface BuildAppOptions {
  config: AppConfig;
  /**
   * If false, the plugins module skips on-disk plugin discovery. Used by
   * tests and by the OpenAPI snapshot dump so the spec is independent of
   * which plugins happen to be installed locally.
   */
  discoverPlugins?: boolean;
}

/**
 * Compose the Fastify application. Pure function of config — no side effects
 * beyond the registered plugins. Used by the entrypoint and by `app.inject()`
 * tests.
 */
export async function buildApp({
  config,
  discoverPlugins = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  app.decorate("config", config);

  // Order matters: zod first (sets type provider), telemetry early (wraps
  // everything), security/rate-limit, then data layer plugins, then errors,
  // then upload/ws/openapi, then modules.
  await app.register(zodPlugin);
  await app.register(telemetryPlugin);
  await app.register(securityPlugin, { config });
  await app.register(rateLimitPlugin, { config });
  // Drizzle is the sole data layer (Postgres + Drizzle migration complete).
  await app.register(dbPlugin);
  // Embedder is registered immediately after db so app.embedderState is
  // available to downstream modules. Model warm-up + worker start happen
  // asynchronously in onReady — registration itself is non-blocking.
  await app.register(embedderPlugin);
  await app.register(cedarPlugin);
  await app.register(authPlugin);
  await app.register(errorsPlugin);
  await app.register(multipartPlugin);
  await app.register(websocketPlugin);
  await app.register(openapiPlugin, { config });

  // Modules — registration order matters because of cross-module decorators:
  // knowledge exposes app.knowledge (used by notes), notes exposes app.notes
  // (used by collab + plugins), collab exposes app.collab (used by notes via
  // optional chaining). Identity stays near the top because plugins/auth
  // already mounts the better-auth catch-all; identity adds /api/users and
  // /api/api-keys plus the apiKey decorator.
  await app.register(platformModule);
  await app.register(identityModule);
  await app.register(knowledgeModule);
  await app.register(notesModule);
  await app.register(collabModule);
  await app.register(agentsModule);
  // pluginsModule accepts an optional notesOps; we leave it at default for
  // now and wire it up in a follow-up once the notes module exposes
  // readNote/writeNote/deleteNote/scanDirectory on its decorator.
  await app.register(pluginsModule({ autoDiscover: discoverPlugins }));
  // Tunnel module: reverse-tunnel client + admin REST. Standalone — has
  // no cross-module dependencies. Registered last so other decorators
  // are available if a future iteration needs them.
  await app.register(tunnelModule);

  // SPA must register after all module routes so its setNotFoundHandler
  // is the final fallback. Falls through API/plugin/ws/docs prefixes
  // back to 404 JSON; everything else gets index.html for client-side
  // routing.
  await app.register(spaPlugin);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}
