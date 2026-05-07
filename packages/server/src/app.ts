import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "./config/index.js";
import { loggerOptions } from "./plugins/logger.js";
import { zodPlugin } from "./plugins/zod.js";
import { telemetryPlugin } from "./plugins/telemetry.js";
import { securityPlugin } from "./plugins/security.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { cedarPlugin } from "./plugins/cedar.js";
import { authPlugin } from "./plugins/auth.js";
import { errorsPlugin } from "./plugins/errors.js";
import { multipartPlugin } from "./plugins/multipart.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { openapiPlugin } from "./plugins/openapi.js";

import { platformModule } from "./modules/platform/index.js";

interface BuildAppOptions {
  config: AppConfig;
}

/**
 * Compose the Fastify application. Pure function of config — no side effects
 * beyond the registered plugins. Used by the entrypoint and by `app.inject()`
 * tests.
 */
export async function buildApp({ config }: BuildAppOptions): Promise<FastifyInstance> {
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
  await app.register(prismaPlugin);
  await app.register(cedarPlugin);
  await app.register(authPlugin);
  await app.register(errorsPlugin);
  await app.register(multipartPlugin);
  await app.register(websocketPlugin);
  await app.register(openapiPlugin, { config });

  // Modules
  await app.register(platformModule);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}
