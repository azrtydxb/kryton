/**
 * Tunnel module — reverse-tunnel client for kryton.ai-managed
 * subdomains.
 *
 * Registers:
 *  - `app.tunnel.state`   — TunnelStateService (Settings-backed persistence)
 *  - `app.tunnel.stats`   — TunnelStatsService (in-memory counters + daily aggregates)
 *  - `app.tunnel.client`  — TunnelClient (state machine + reconnect loop)
 *  - admin REST routes under /api/admin/tunnel/*
 *
 * On app start, reads the stored JWT (if any) and kicks off the
 * connect loop. On `onClose`, drains gracefully.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §1.3.
 */
import type { FastifyPluginAsync } from "fastify";

import { TunnelStateService } from "./services/tunnel-state.service.js";
import { TunnelStatsService } from "./services/tunnel-stats.service.js";
import { TunnelClient } from "./services/tunnel-client.service.js";
import { adminTunnelRoutes } from "./routes/admin-tunnel.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    tunnel: {
      state: TunnelStateService;
      stats: TunnelStatsService;
      client: TunnelClient;
    };
  }
}

export const tunnelModule: FastifyPluginAsync = async (app) => {
  // Build services. They are tied to app.db (Drizzle) which was
  // registered by dbPlugin earlier in app.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (app as unknown as { db: any }).db;
  const state = new TunnelStateService(db);
  const stats = new TunnelStatsService(db);
  const client = new TunnelClient({
    state,
    log: app.log as unknown as {
      info: (...a: unknown[]) => void;
      warn: (...a: unknown[]) => void;
      error: (...a: unknown[]) => void;
    },
  });

  app.decorate("tunnel", { state, stats, client });

  // Start stats flush ticker. Stop on shutdown.
  stats.start();

  // Admin routes mount under /api/admin (matches existing admin routes).
  await app.register(
    async (scope) => {
      await scope.register(adminTunnelRoutes);
    },
    { prefix: "/api/admin" },
  );

  // After Fastify is fully ready and listening, attempt to start the
  // tunnel client if we have a stored JWT. We use onListen so we know
  // the local port (for the loopback injector — added in Phase 4 of
  // the plan).
  app.addHook("onListen", async () => {
    const jwt = await state.getJwt().catch(() => null);
    if (jwt) {
      app.log.info("tunnel module: starting client with stored JWT");
      await client.start(jwt).catch((err) => {
        app.log.warn({ err }, "tunnel client failed to start");
      });
    } else {
      app.log.info("tunnel module: no stored JWT; client remains idle");
    }
  });

  app.addHook("onClose", async () => {
    await client.stop({ timeoutMs: 5_000 }).catch(() => undefined);
    await stats.stop().catch(() => undefined);
  });
};
