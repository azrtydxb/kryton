/**
 * Tunnel module — reverse-tunnel client for kryton.ai-managed
 * subdomains.
 *
 * On boot:
 *   1. Reads stored JWT from Settings.
 *   2. If present, dials tunnel.kryton.ai over h2 CONNECT, runs a
 *      yamux session over the CONNECT body, and pipes each inbound
 *      yamux stream to the local Fastify listener via TCP loopback.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §1.3.
 */
import type { AddressInfo } from "node:net";
import type { FastifyPluginAsync, FastifyBaseLogger } from "fastify";

import { TunnelStateService } from "./services/tunnel-state.service.js";
import { TunnelStatsService } from "./services/tunnel-stats.service.js";
import { TunnelClient } from "./services/tunnel-client.service.js";
import { LoopbackInjector } from "./services/loopback-injector.service.js";
import { adminTunnelRoutes } from "./routes/admin-tunnel.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    tunnel: {
      state: TunnelStateService;
      stats: TunnelStatsService;
      client: TunnelClient;
      loopback: LoopbackInjector;
    };
  }
}

export const tunnelModule: FastifyPluginAsync = async (app) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (app as unknown as { db: any }).db;
  const state = new TunnelStateService(db);
  const stats = new TunnelStatsService(db);

  const log = app.log as unknown as FastifyBaseLogger & {
    debug: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };

  const loopback = new LoopbackInjector({
    log: {
      debug: (...a: unknown[]) => log.debug(...(a as Parameters<typeof log.debug>)),
      warn: (...a: unknown[]) => log.warn(...(a as Parameters<typeof log.warn>)),
      error: (...a: unknown[]) => log.error(...(a as Parameters<typeof log.error>)),
    },
    stats,
  });

  const client = new TunnelClient({
    state,
    loopback,
    log: {
      info: (...a: unknown[]) => log.info(...(a as Parameters<typeof log.info>)),
      warn: (...a: unknown[]) => log.warn(...(a as Parameters<typeof log.warn>)),
      error: (...a: unknown[]) => log.error(...(a as Parameters<typeof log.error>)),
    },
    serverUrl: process.env.KRYTON_TUNNEL_SERVER_URL ?? "https://tunnel.kryton.ai",
    krytonVersion: process.env.npm_package_version ?? "0.0.0",
  });

  app.decorate("tunnel", { state, stats, client, loopback });

  stats.start();

  await app.register(
    async (scope) => {
      await scope.register(adminTunnelRoutes);
    },
    { prefix: "/api/admin" },
  );

  app.addHook("onListen", async () => {
    const addr = app.server.address();
    if (addr && typeof addr === "object") {
      const port = (addr as AddressInfo).port;
      loopback.setLocalPort(port);
      app.log.info({ port }, "tunnel module: loopback target port wired");
    }

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
