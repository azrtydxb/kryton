import { Express, Router, RequestHandler } from "express";
import { HttpMethod } from "./types";

interface RouteEntry {
  method: HttpMethod;
  path: string;
}

export class PluginRouter {
  private app: Express;
  private authMiddleware: RequestHandler | null;
  private routers = new Map<string, Router>();
  private routes = new Map<string, RouteEntry[]>();

  constructor(app: Express, authMiddleware?: RequestHandler) {
    this.app = app;
    this.authMiddleware = authMiddleware || null;
  }

  register(
    pluginId: string,
    method: HttpMethod,
    path: string,
    handler: RequestHandler
  ): void {
    let router = this.routers.get(pluginId);
    if (!router) {
      router = Router();
      this.routers.set(pluginId, router);
      if (this.authMiddleware) {
        this.app.use(`/api/plugins/${pluginId}`, this.authMiddleware, router);
      } else {
        this.app.use(`/api/plugins/${pluginId}`, router);
      }
    }

    router[method](path, handler);

    const entries = this.routes.get(pluginId) || [];
    entries.push({ method, path });
    this.routes.set(pluginId, entries);
  }

  removeAllForPlugin(pluginId: string): void {
    const router = this.routers.get(pluginId);
    if (router) {
      // Replace router's stack to remove all routes
      router.stack.length = 0;
    }
    this.routers.delete(pluginId);
    this.routes.delete(pluginId);
  }

  getRoutesForPlugin(pluginId: string): RouteEntry[] {
    return this.routes.get(pluginId) || [];
  }
}
