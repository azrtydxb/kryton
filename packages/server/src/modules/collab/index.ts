import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import * as Y from "yjs";
import { ShareService } from "./services/share.service.js";
import { YjsPersistence } from "./ws/persistence.js";
import { sharesRoutes, accessRequestsRoutes } from "./routes/shares.routes.js";
import { registerYjsRoutes, type YjsRegistry } from "./ws/yjs.handler.js";
import { DiskWatcherManager } from "./disk-watcher.js";
import type { VaultEventOrigin } from "../vault-events/types.js";

export interface CollabApi {
  getDoc(docId: string): Y.Doc | null;
  broadcast(docId: string, msg: Uint8Array): void;
  hasAccess(
    ownerUserId: string,
    notePath: string,
    viewerUserId: string,
  ): Promise<{ canRead: boolean; canWrite: boolean }>;
  /** True iff a live Y.Doc exists for `(docId, userId)`. */
  hasLiveDoc(docId: string, userId: string): boolean;
  /**
   * Route a server-initiated content write into the live Y.Doc rather
   * than touching disk directly. See `note.service.ts` writeNote for
   * the invariant.
   */
  applyServerEdit(
    docId: string,
    userId: string,
    origin: VaultEventOrigin,
    content: string,
  ): Promise<void>;
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
  // Wire the notes-module deps so the persistence layer can flush
  // Y.Text("content") back to the canonical `.md` file on every
  // debounced save. The notes module decorates `app` before the collab
  // module registers (see app.ts), so both decorators are guaranteed
  // to be present here.
  const persistence = new YjsPersistence(app.db, {
    noteService: app.noteService,
    resolveNotesDir: (userId) => app.notes.getUserNotesDir(userId),
  });

  let registry: YjsRegistry | null = null;

  // Register HTTP routes
  await app.register(sharesRoutes({ shareService }), { prefix: "/api/shares" });
  await app.register(accessRequestsRoutes, { prefix: "/api/access-requests" });

  // Register WS route in an encapsulated child plugin so the websocket
  // route handler can be attached.
  await app.register(async (childApp) => {
    registry = registerYjsRoutes(childApp, {
      persistence,
      resolveNotesDir: (userId) => app.notes.getUserNotesDir(userId),
    });
  });

  if (!registry) throw new Error("yjs registry failed to initialise");
  const yjs = registry as YjsRegistry;

  // Per-user disk watcher. Started on the first Y.Doc opened by a user,
  // stopped on last eviction — avoids watching notes dirs for users who
  // aren't actively editing.
  const diskWatcher = new DiskWatcherManager({
    log: app.log,
    registry: yjs,
  });
  yjs.setLifecycleHandlers({
    onUserActive: (userId, notesDir) => diskWatcher.start(userId, notesDir),
    onUserIdle: (userId) => void diskWatcher.stop(userId),
  });

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
    hasLiveDoc(docId, userId) {
      return yjs.hasLiveDoc(docId, userId);
    },
    applyServerEdit(docId, userId, origin, content) {
      return yjs.applyServerEdit(docId, userId, origin, content);
    },
  };
  app.decorate("collab", collabApi);

  // Graceful shutdown: flush all dirty docs.
  app.addHook("onClose", async () => {
    await yjs.flushAll();
    await diskWatcher.stopAll();
  });
};

// Wrapped with `fastify-plugin` so `app.collab` and `app.shares`
// propagate to sibling modules (agents/MCP needs both).
export const collabModule: FastifyPluginAsync = fp(collabModuleImpl, {
  name: "collab-module",
});
