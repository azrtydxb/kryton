import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { HttpMethod, PluginRouteHandler } from "./types.js";

interface RouteEntry {
  method: HttpMethod;
  path: string;
}

/**
 * Fastify equivalent of the legacy Express PluginRouter. Plugins call
 * `register()` from inside `activate()` to mount routes under
 * `/api/plugins/{pluginId}/*`. All routes go through the supplied
 * `authPreHandler` (typically `app.auth.requireUser`).
 *
 * Notes on differences from the old Express router:
 *  - Fastify does not allow unregistering routes at runtime. Instead,
 *    `removeAllForPlugin()` marks the plugin id as "disabled" and the
 *    pre-handler short-circuits with a 404 for any disabled plugin's
 *    routes. The route entries remain in the radix tree but are inert.
 *  - All route registration happens before the server's ready phase.
 *    Hot-reload will not be able to add new routes after `app.ready()`
 *    without restarting the process. For now, plugin discovery must run
 *    during the host module's setup.
 */
export class PluginRouter {
  private readonly app: FastifyInstance;
  private readonly authPreHandler: preHandlerHookHandler | null;
  private readonly routes = new Map<string, RouteEntry[]>();
  private readonly disabledPlugins = new Set<string>();

  constructor(app: FastifyInstance, authPreHandler?: preHandlerHookHandler) {
    this.app = app;
    this.authPreHandler = authPreHandler ?? null;
  }

  register(
    pluginId: string,
    method: HttpMethod,
    routePath: string,
    handler: PluginRouteHandler,
  ): void {
    // If we previously disabled this plugin, re-enable it on (re)registration.
    this.disabledPlugins.delete(pluginId);

    const fullPath = this.joinPath(`/api/plugins/${pluginId}`, routePath);

    const preHandlers: preHandlerHookHandler[] = [];
    if (this.authPreHandler) preHandlers.push(this.authPreHandler);
    preHandlers.push(this.makeDisabledGuard(pluginId));

    this.app.route({
      method: method.toUpperCase() as Uppercase<HttpMethod>,
      url: fullPath,
      preHandler: preHandlers,
      handler: async (request, reply) => {
        return handler(request, reply);
      },
    });

    const entries = this.routes.get(pluginId) ?? [];
    entries.push({ method, path: routePath });
    this.routes.set(pluginId, entries);
  }

  removeAllForPlugin(pluginId: string): void {
    this.disabledPlugins.add(pluginId);
    this.routes.delete(pluginId);
  }

  getRoutesForPlugin(pluginId: string): RouteEntry[] {
    return this.routes.get(pluginId) ?? [];
  }

  private makeDisabledGuard(pluginId: string): preHandlerHookHandler {
    return async (_req: FastifyRequest, reply) => {
      if (this.disabledPlugins.has(pluginId)) {
        reply.code(404).send({ error: "Plugin not found" });
      }
    };
  }

  private joinPath(prefix: string, suffix: string): string {
    if (!suffix || suffix === "/") return prefix;
    if (suffix.startsWith("/")) return prefix + suffix;
    return `${prefix}/${suffix}`;
  }
}
