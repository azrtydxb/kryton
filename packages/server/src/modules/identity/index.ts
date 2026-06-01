import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { ApiKeyService } from "./services/api-key.service.js";
import { usersRoutes } from "./routes/users.routes.js";
import { apiKeysRoutes } from "./routes/api-keys.routes.js";
import { pushRoutes } from "./routes/push.routes.js";
import { notificationsRoutes } from "./routes/notifications.routes.js";
import { notificationBus } from "./services/notifications/bus.js";
import { dispatchPush } from "./services/push/dispatcher.js";
import { sendApns, getDefaultProvider } from "./services/push/apns.js";
import { sendFcm, getDefaultMessaging } from "./services/push/fcm.js";
import { pushDevices } from "../../db/schema/push.js";
import { eq } from "drizzle-orm";

const identityModuleImpl: FastifyPluginAsync = async (app) => {
  const apiKeyService = new ApiKeyService(app);

  if (!app.hasDecorator("identity")) {
    app.decorate("identity", { apiKey: apiKeyService });
  }

  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(apiKeysRoutes({ apiKeyService }), { prefix: "/api/api-keys" });
  await app.register(pushRoutes, { prefix: "/api/push" });
  await app.register(notificationsRoutes);

  // Wire the push dispatcher to the notification bus. Only active when both
  // APNs and FCM credentials are configured; otherwise a warning is logged and
  // background push delivery is skipped (SSE stream still works).
  // Guard on `app.hasDecorator("config")` so unit tests that build a minimal
  // Fastify instance without the config decorator don't fail here.
  const cfg = app.hasDecorator("config") ? app.config : null;
  // Require EVERY APNs + FCM field the dispatcher dereferences below, not just
  // the two path vars — a partial config would otherwise crash at startup on
  // the non-null assertions.
  const pushConfigured =
    !!cfg?.APNS_KEY_PATH &&
    !!cfg?.APNS_KEY_ID &&
    !!cfg?.APNS_TEAM_ID &&
    !!cfg?.APNS_BUNDLE_ID &&
    !!cfg?.FCM_SERVICE_ACCOUNT_PATH &&
    !!cfg?.FCM_PROJECT_ID;
  if (cfg && pushConfigured) {
    const provider = getDefaultProvider({
      keyPath: cfg.APNS_KEY_PATH!,
      keyId: cfg.APNS_KEY_ID!,
      teamId: cfg.APNS_TEAM_ID!,
      production: cfg.APNS_PRODUCTION ?? false,
    });
    const messaging = getDefaultMessaging({
      serviceAccountPath: cfg.FCM_SERVICE_ACCOUNT_PATH!,
      projectId: cfg.FCM_PROJECT_ID!,
    });
    notificationBus.onAfterPublish(async (event) => {
      // Push delivery is best-effort: never let a send failure reject
      // NotificationBus.publish() and break the path that emitted the event.
      try {
        await dispatchPush(event, {
          sendApns: (p) => sendApns(p, { provider, bundleId: cfg.APNS_BUNDLE_ID! }),
          sendFcm: (p) => sendFcm(p, { messaging }),
          listDevices: async (userId) =>
            app.db
              .select({ id: pushDevices.id, platform: pushDevices.platform, token: pushDevices.token })
              .from(pushDevices)
              .where(eq(pushDevices.userId, userId)),
          prune: async (id) => {
            await app.db.delete(pushDevices).where(eq(pushDevices.id, id));
          },
        });
      } catch (err) {
        app.log.error({ err }, "push dispatch failed");
      }
    });
    app.log.info("push dispatcher wired");
  } else {
    app.log.warn("push dispatcher disabled (APNS_* and FCM_* env vars not set)");
  }
};

/**
 * Identity module — users, API keys, and auth helpers.
 *
 * Note: Better Auth catch-all (`/api/auth/*`) is mounted by `plugins/auth.ts`,
 * not here. This module owns the user-facing identity REST surface.
 *
 * Wrapped with `fastify-plugin` so `app.identity.apiKey` is visible to
 * siblings (notably `plugins/auth.ts` for API-key validation).
 */
export const identityModule: FastifyPluginAsync = fp(identityModuleImpl, {
  name: "identity-module",
});
