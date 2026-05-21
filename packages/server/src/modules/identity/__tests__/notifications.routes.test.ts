import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError } from "../../../lib/errors.js";
import type { AuthApi } from "../../../plugins/auth.js";
import { notificationsRoutes } from "../routes/notifications.routes.js";

/**
 * SSE stream tests.
 *
 * Full streaming behaviour (heartbeat, live event delivery) is not testable via
 * Fastify's `app.inject()` because inject() does not support long-lived
 * connections. These tests verify auth enforcement and route registration only.
 * End-to-end streaming is verified manually / in CI integration tests.
 */

/**
 * Build a minimal Fastify app that only mounts notificationsRoutes with a
 * stubbed auth layer. No DB required — this is a pure unit test.
 */
async function buildNotificationsTestApp(opts: { authenticated: boolean }) {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  const authApi: AuthApi = {
    instance: {} as never,
    async resolve() {
      return null;
    },
    async requireUser() {
      if (!opts.authenticated) throw new AuthError("Missing or invalid session");
      return { id: "unit-user", email: "unit@test.local", name: "unit", role: "user" };
    },
    async requireAuth() {
      if (!opts.authenticated) throw new AuthError("Missing or invalid session");
      return {
        user: { id: "unit-user", email: "unit@test.local", name: "unit", role: "user" },
        apiKey: null,
        agentId: null,
      };
    },
    async getOptionalUser() {
      return null;
    },
    async requireAdmin() {
      throw new AuthError("not needed");
    },
    requireWriteScope() {},
    requireSession() {},
    async authenticateWsToken() {
      return null;
    },
  };

  app.decorate("auth", authApi);
  await app.register(errorsPlugin);
  await app.register(notificationsRoutes);
  await app.ready();
  return app;
}

describe("identity / notifications routes", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("returns 401 for unauthenticated requests", async () => {
    const app = await buildNotificationsTestApp({ authenticated: false });
    close = () => app.close();

    const res = await app.inject({
      method: "GET",
      url: "/api/notifications/stream",
    });

    expect(res.statusCode).toBe(401);
  });

  it("route is registered and visible in the route table", async () => {
    const app = await buildNotificationsTestApp({ authenticated: true });
    close = () => app.close();

    const routes = app.printRoutes();
    expect(routes).toContain("api/notifications/stream");
  });
});
