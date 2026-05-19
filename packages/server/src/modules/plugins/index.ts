import path from "node:path";
import fs from "node:fs/promises";
import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { installedPlugin } from "../../db/schema/settings.js";
import { PluginEventBus } from "./services/event-bus.js";
import { PluginHealthMonitor } from "./services/health-monitor.js";
import { PluginRouter } from "./services/plugin-router.js";
import { PluginApiFactory } from "./services/api-factory.js";
import { PluginManager } from "./services/manager.js";
import { PluginWebSocket } from "./services/plugin-websocket.js";
import { PluginStorageService } from "./services/storage.service.js";
import { PluginRegistryService } from "./services/registry.service.js";
import { pluginsRoutes } from "./routes/plugins.routes.js";
import { builtinNotesRoutes } from "./routes/builtin-notes.routes.js";
import { builtinStorageRoutes } from "./routes/builtin-storage.routes.js";
import type { NotesOps } from "./services/types.js";

declare module "fastify" {
  interface FastifyInstance {
    plugins: {
      eventBus: PluginEventBus;
      manager: PluginManager;
      router: PluginRouter;
      healthMonitor: PluginHealthMonitor;
      apiFactory: PluginApiFactory;
      registry: PluginRegistryService;
      storage: PluginStorageService;
      websocket: PluginWebSocket;
    };
  }
}

export interface PluginsModuleOptions {
  /**
   * Directory containing plugin packages (each subdir has manifest.json).
   * Defaults to `<cwd>/plugins`.
   */
  pluginsDir?: string;
  /**
   * Notes root directory used by the plugin notes API. Defaults to
   * `<cwd>/notes`.
   */
  notesDir?: string;
  /**
   * Notes operations bridge. Plugins need read/write access to the notes
   * tree via the `api.notes` API. The host injects the concrete service
   * functions here so this module remains free of legacy `services/`
   * imports.
   */
  notesOps?: NotesOps;
  /**
   * If true (default), discover plugins on the filesystem and load them
   * before `app.ready()`. Tests may want to skip this.
   */
  autoDiscover?: boolean;
}

// notesOps was previously sourced via a stringly-typed cast off of
// `app.noteService` with a throwing noop fallback. The fastify-plugin
// `dependencies: ["notes-module"]` declaration below now enforces
// registration order at boot, so when this module loads the notes
// module's NoteService decorator is guaranteed to exist.

/**
 * Plugins module — Kryton plugin runtime.
 *
 * Decorates `fastify.plugins` with the manager / event bus / etc., exposes
 * REST endpoints under `/api/plugins`, and a WebSocket channel at
 * `/ws/plugins` for lifecycle events.
 */
const pluginsModuleImpl = (options: PluginsModuleOptions = {}): FastifyPluginAsync =>
  async (app) => {
    const pluginsDir =
      options.pluginsDir ?? path.resolve(process.cwd(), "plugins");
    // Resolve notesDir consistently with the host's NotesService (which
    // honors app.config.NOTES_DIR, default "../../notes" relative to cwd).
    // Using `path.resolve(cwd, "notes")` here meant the plugin builtin
    // routes wrote to a different directory than the rest of the app, so
    // a note created via api.notes.update never appeared in the host
    // file tree. Fall back to the cwd-local "notes" only when neither an
    // option nor the config is set.
    const configNotesDir = (app.config as { NOTES_DIR?: string } | undefined)
      ?.NOTES_DIR;
    const notesDir =
      options.notesDir
      ?? (configNotesDir
        ? (configNotesDir.startsWith("/")
          ? configNotesDir
          : path.resolve(process.cwd(), configNotesDir))
        : path.resolve(process.cwd(), "notes"));
    // Default notesOps to the notes module's NoteService decorator
    // (signatures match exactly). Tests can pass `options.notesOps` to
    // inject a mock implementation, but the `dependencies: ["notes-module"]`
    // declaration on this fastify-plugin wrapper means the notes module
    // still has to register first — the override replaces the routed
    // operations, not the registration order.
    const notesOps: NotesOps = options.notesOps ?? app.noteService;
    if (!notesOps) {
      // Should not be reachable under normal boot because the
      // fastify-plugin `dependencies` declaration on this module
      // requires `notes-module` to register first.
      throw new Error(
        "plugins module: app.noteService missing — notes module must register first",
      );
    }

    await fs.mkdir(pluginsDir, { recursive: true });

    // ── Construct services ─────────────────────────────────────────────
    const eventBus = new PluginEventBus();

    // Attach user to req so legacy plugin code reading `req.user?.id`
    // (Express convention) keeps working.
    const authPreHandler: preHandlerHookHandler = async (req) => {
      const user = await app.auth.requireUser(req);
      (req as unknown as { user: typeof user }).user = user;
    };
    const pluginRouter = new PluginRouter(app, authPreHandler);

    const managerRef: { instance: PluginManager | null } = { instance: null };
    const healthMonitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable: async (pluginId) => {
        app.log.warn({ pluginId }, "auto-disabling plugin (excessive errors)");
        await managerRef.instance?.disablePlugin(pluginId);
        try {
          await app.db
            .update(installedPlugin)
            .set({
              enabled: false,
              state: "error",
              error: "Auto-disabled: too many errors",
              updatedAt: new Date(),
            })
            .where(eq(installedPlugin.id, pluginId));
        } catch (err) {
          app.log.error({ err, pluginId }, "failed to mark plugin disabled");
        }
      },
    });

    const storage = new PluginStorageService(app.db);
    const registry = new PluginRegistryService({
      warn: (msg) => app.log.warn(msg),
    });

    const fastifyLogger = {
      info: (msg: string) => app.log.info(msg),
      warn: (msg: string) => app.log.warn(msg),
      error: (msg: string) => app.log.error(msg),
    };

    const apiFactory = new PluginApiFactory({
      eventBus,
      pluginRouter,
      healthMonitor,
      storage,
      db: app.db,
      notesDir,
      notesOps,
      loggerFactory: (tag: string) => ({
        info: (msg: string) => app.log.info(`[${tag}] ${msg}`),
        warn: (msg: string) => app.log.warn(`[${tag}] ${msg}`),
        error: (msg: string) => app.log.error(`[${tag}] ${msg}`),
      }),
    });

    const manager = new PluginManager({
      pluginsDir,
      eventBus,
      pluginRouter,
      healthMonitor,
      apiFactory,
      db: app.db,
      logger: fastifyLogger,
    });
    managerRef.instance = manager;

    const websocket = new PluginWebSocket(app);
    manager.setPluginWebSocket(websocket);

    // ── Decorate ───────────────────────────────────────────────────────
    app.decorate("plugins", {
      eventBus,
      manager,
      router: pluginRouter,
      healthMonitor,
      apiFactory,
      registry,
      storage,
      websocket,
    });

    // ── Register HTTP routes ───────────────────────────────────────────
    await app.register(
      pluginsRoutes({ pluginManager: manager, registry, pluginsDir }),
      { prefix: "/api/plugins" },
    );

    // Built-in client-plugin APIs (notes + storage). These are surfaced to
    // *client* plugins via the `api.notes` / `api.storage` namespaces built
    // in PluginRoot.tsx. They mirror the server-side `api.notes` / `api.storage`
    // but are scoped to the calling user's session (no `userId` arg).
    await app.register(
      builtinNotesRoutes({ notesDir, notesOps, eventBus }),
      { prefix: "/api/plugin-builtin/notes" },
    );
    await app.register(
      builtinStorageRoutes({ storage }),
      { prefix: "/api/plugin-builtin/storage" },
    );

    // ── Static plugin assets ───────────────────────────────────────────
    // Plugin client bundles live on disk under <pluginsDir>/<id>/client/...
    // The active-plugins API advertises them as /plugins/<id>/client/index.js
    // (see /api/plugins/active response). Only that subtree is web-reachable
    // — everything else in a plugin directory (server.js, manifest.json,
    // lockfile, .env, etc.) is intentionally NOT served. Using @fastify/static
    // rooted at `pluginsDir` would expose every file in every plugin
    // directory; this hand-rolled handler enforces the "<id>/client/..."
    // path shape and resolves through realpath to defeat any symlink-based
    // escape out of the client subtree.
    // `pluginsDir` is created above with mkdir({recursive:true}) so this
    // always resolves under normal operation. Re-use the top-level
    // `fs` import; no dynamic re-import is needed.
    const pluginsDirReal = await fs.realpath(pluginsDir);

    app.route({
      method: "GET",
      url: "/plugins/*",
      schema: { hide: true },
      handler: async (req, reply) => {
        const wildcard = (req.params as { "*"?: string })["*"] ?? "";
        // Path shape: <id>/client/<rest>. Reject anything else.
        const segments = wildcard.split("/").filter((s) => s.length > 0);
        if (segments.length < 3 || segments[1] !== "client") {
          return reply.code(404).send();
        }
        const [pluginId, , ...rest] = segments;
        // Plugin IDs must match the same allowlist used at install
        // (alnum / dash / underscore) so we can't be tricked into
        // resolving to a sibling directory.
        if (!/^[a-zA-Z0-9_-]+$/.test(pluginId)) {
          return reply.code(404).send();
        }
        const clientRoot = path.join(pluginsDirReal, pluginId, "client");
        const target = path.join(clientRoot, ...rest);
        // Resolve through realpath so a symlink inside client/ that
        // points back out (e.g. ../../../../etc/passwd) doesn't escape.
        let real: string;
        try {
          real = await fs.realpath(target);
        } catch {
          return reply.code(404).send();
        }
        if (real !== clientRoot && !real.startsWith(clientRoot + path.sep)) {
          return reply.code(404).send();
        }
        return reply.sendFile(
          path.relative(pluginsDirReal, real),
          pluginsDirReal,
        );
      },
    });

    // @fastify/static still has to register so `reply.sendFile` exists,
    // but with `serve: false` it doesn't auto-serve anything. The
    // hand-rolled handler above is the only entry point into the
    // plugin asset tree.
    const fastifyStatic = await import("@fastify/static");
    await app.register(fastifyStatic.default, {
      root: pluginsDirReal,
      serve: false,
      decorateReply: true,
    });

    // ── Discover plugins on disk ───────────────────────────────────────
    if (options.autoDiscover !== false) {
      try {
        await manager.discoverAndLoadPlugins();
      } catch (err) {
        app.log.error({ err }, "plugin discovery failed");
      }
    }

    app.addHook("onClose", async () => {
      websocket.close();
    });
  };

/**
 * Public module entrypoint. Wrapped with `fastify-plugin` so the
 * `app.plugins` decorator escapes the encapsulation boundary and is
 * visible to siblings + tests that call `app.plugins.manager` directly.
 */
export const pluginsModule = (options: PluginsModuleOptions = {}): FastifyPluginAsync =>
  fp(pluginsModuleImpl(options), {
    name: "plugins-module",
    // `notes-module` decorates `app.noteService`, which we depend on for
    // the default NotesOps. Declaring the dependency here lets fastify-
    // plugin enforce registration order at boot rather than relying on
    // app.ts ordering by convention.
    dependencies: ["notes-module"],
  });
