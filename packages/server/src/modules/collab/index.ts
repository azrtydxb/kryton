import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import * as Y from "yjs";
import { ShareService } from "./services/share.service.js";
import { YjsPersistence } from "./ws/persistence.js";
import { sharesRoutes, accessRequestsRoutes } from "./routes/shares.routes.js";
import { registerYjsRoutes, type YjsRegistry } from "./ws/yjs.handler.js";

export interface CollabApi {
  getDoc(docId: string): Y.Doc | null;
  broadcast(docId: string, msg: Uint8Array): void;
  hasAccess(
    ownerUserId: string,
    notePath: string,
    viewerUserId: string,
  ): Promise<{ canRead: boolean; canWrite: boolean }>;
}

declare module "fastify" {
  interface FastifyInstance {
    collab?: CollabApi;
    shares: ShareService;
  }
}

/**
 * Collab module — note shares, access requests, and Yjs WebSocket.
 *
 * Mounts:
 *   - HTTP: /api/shares/*, /api/access-requests/*
 *   - WS:   /ws/yjs/:docId
 *
 * Exposes:
 *   - app.collab.getDoc(docId)
 *   - app.collab.broadcast(docId, msg)
 *
 * Graceful shutdown: an `onClose` hook flushes all dirty Y.Docs to Postgres.
 */
const collabModuleImpl: FastifyPluginAsync = async (app) => {
  const shareService = new ShareService(app.db);
  if (!app.hasDecorator("shares")) {
    app.decorate("shares", shareService);
  }
  const persistence = new YjsPersistence(app.db);

  let registry: YjsRegistry | null = null;

  // Register HTTP routes
  await app.register(sharesRoutes({ shareService }), { prefix: "/api/shares" });
  await app.register(accessRequestsRoutes, { prefix: "/api/access-requests" });

  // Register WS route in an encapsulated child plugin so the websocket
  // route handler can be attached.
  await app.register(async (childApp) => {
    registry = registerYjsRoutes(childApp, { persistence });
  });

  if (!registry) throw new Error("yjs registry failed to initialise");
  const yjs = registry as YjsRegistry;

  const collabApi: CollabApi = {
    getDoc(docId) {
      return yjs.getDoc(docId);
    },
    broadcast(docId, msg) {
      yjs.broadcast(docId, msg);
    },
    hasAccess(ownerUserId, notePath, viewerUserId) {
      return shareService.hasAccess(ownerUserId, notePath, viewerUserId);
    },
  };
  app.decorate("collab", collabApi);

  // Graceful shutdown: flush all dirty docs.
  app.addHook("onClose", async () => {
    await yjs.flushAll();
  });
};

// Wrapped with `fastify-plugin` so `app.collab` and `app.shares`
// propagate to sibling modules (agents/MCP needs both).
export const collabModule: FastifyPluginAsync = fp(collabModuleImpl, {
  name: "collab-module",
});
