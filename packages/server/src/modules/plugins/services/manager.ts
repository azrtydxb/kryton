import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyInstance } from "fastify";
import type {
  PluginInstance,
  PluginManifest,
  PluginModule,
} from "./types.js";
import type { PluginEventBus } from "./event-bus.js";
import type { PluginRouter } from "./plugin-router.js";
import type { PluginHealthMonitor } from "./health-monitor.js";
import type { PluginApiFactory } from "./api-factory.js";
import type { PluginWebSocket } from "./plugin-websocket.js";

const require = createRequire(import.meta.url);

type Prisma = FastifyInstance["prisma"];

interface SimpleLogger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export interface PluginManagerDeps {
  pluginsDir: string;
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  apiFactory: PluginApiFactory;
  prisma: Prisma;
  logger: SimpleLogger;
  pluginWebSocket?: PluginWebSocket;
}

export class PluginManager {
  private deps: PluginManagerDeps;
  private plugins = new Map<string, PluginInstance>();
  private activationTimeoutMs = 10_000;

  constructor(deps: PluginManagerDeps) {
    this.deps = deps;
  }

  setActivationTimeout(ms: number): void {
    this.activationTimeoutMs = ms;
  }

  setPluginWebSocket(ws: PluginWebSocket): void {
    this.deps.pluginWebSocket = ws;
  }

  private async persistPluginState(
    manifest: PluginManifest,
    state: string,
    error: string | null = null,
  ): Promise<void> {
    try {
      await this.deps.prisma.installedPlugin.upsert({
        where: { id: manifest.id },
        create: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? "",
          author: manifest.author ?? "",
          state,
          error,
          manifest: manifest as unknown as object,
          enabled: state !== "error" && state !== "unloaded",
        },
        update: {
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? "",
          author: manifest.author ?? "",
          state,
          error,
          manifest: manifest as unknown as object,
          enabled: state !== "error" && state !== "unloaded",
        },
      });
    } catch (err) {
      this.deps.logger.error(`Failed to persist state for ${manifest.id}: ${(err as Error).message}`);
    }
  }

  private async persistEnabled(pluginId: string, enabled: boolean): Promise<void> {
    try {
      await this.deps.prisma.installedPlugin.update({
        where: { id: pluginId },
        data: { enabled },
      });
    } catch (err) {
      this.deps.logger.error(`Failed to update enabled for ${pluginId}: ${(err as Error).message}`);
    }
  }

  async loadPlugin(pluginId: string): Promise<void> {
    const pluginDir = path.join(this.deps.pluginsDir, pluginId);
    const manifestPath = path.join(pluginDir, "manifest.json");

    const manifestRaw = await fs.readFile(manifestPath, "utf-8");
    const manifest: PluginManifest = JSON.parse(manifestRaw);

    const instance: PluginInstance = {
      manifest,
      state: "installed",
      module: null,
      api: null,
      error: null,
      registeredRoutes: [],
      registeredEvents: [],
    };

    this.plugins.set(pluginId, instance);

    if (!manifest.server) {
      instance.state = "active";
      await this.persistPluginState(manifest, "active");
      this.deps.pluginWebSocket?.broadcast("plugin:activated", { id: pluginId, name: manifest.name });
      return;
    }

    // Load module - validate the resolved path stays within the plugin directory
    const serverEntry = path.resolve(pluginDir, manifest.server);
    const resolvedPluginDir = path.resolve(pluginDir);
    if (!serverEntry.startsWith(resolvedPluginDir + path.sep) && serverEntry !== resolvedPluginDir) {
      instance.state = "error";
      instance.error = "Invalid server entry: path traversal detected";
      await this.persistPluginState(manifest, "error", instance.error);
      return;
    }
    try {
      delete require.cache[require.resolve(serverEntry)];
    } catch {
      // Not cached yet
    }

    let mod: PluginModule;
    try {
      mod = require(serverEntry) as PluginModule;
      instance.module = mod;
      instance.state = "loaded";
    } catch (err) {
      instance.state = "error";
      instance.error = `Failed to load: ${(err as Error).message}`;
      await this.persistPluginState(manifest, "error", instance.error);
      this.deps.pluginWebSocket?.broadcast("plugin:error", {
        id: pluginId,
        name: manifest.name,
        error: instance.error,
      });
      return;
    }

    // Activate with timeout
    const api = this.deps.apiFactory.createApi(manifest);
    instance.api = api;

    try {
      await Promise.race([
        Promise.resolve(mod.activate(api)),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Activation timeout")),
            this.activationTimeoutMs,
          ),
        ),
      ]);
      instance.state = "active";
      await this.persistPluginState(manifest, "active");
      this.deps.pluginWebSocket?.broadcast("plugin:activated", { id: pluginId, name: manifest.name });
    } catch (err) {
      instance.state = "error";
      instance.error = `Activation failed: ${(err as Error).message}`;
      this.deps.eventBus.removeAllForPlugin(pluginId);
      this.deps.pluginRouter.removeAllForPlugin(pluginId);
      await this.persistPluginState(manifest, "error", instance.error);
      this.deps.pluginWebSocket?.broadcast("plugin:error", {
        id: pluginId,
        name: manifest.name,
        error: instance.error,
      });
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    instance.state = "deactivating";

    if (instance.module?.deactivate) {
      try {
        await Promise.resolve(instance.module.deactivate());
      } catch {
        // Best effort
      }
    }

    this.deps.eventBus.removeAllForPlugin(pluginId);
    this.deps.pluginRouter.removeAllForPlugin(pluginId);
    this.deps.healthMonitor.reset(pluginId);

    if (instance.manifest.server) {
      const serverEntry = path.resolve(
        this.deps.pluginsDir,
        pluginId,
        instance.manifest.server,
      );
      try {
        delete require.cache[require.resolve(serverEntry)];
      } catch {
        // Not cached
      }
    }

    instance.state = "unloaded";
    instance.module = null;
    instance.api = null;

    await this.persistPluginState(instance.manifest, "unloaded");
    this.deps.pluginWebSocket?.broadcast("plugin:deactivated", {
      id: pluginId,
      name: instance.manifest.name,
    });
  }

  async disablePlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this.persistEnabled(pluginId, false);
  }

  async reloadPlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this.loadPlugin(pluginId);
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getActivePlugins(): PluginInstance[] {
    return this.listPlugins().filter((p) => p.state === "active");
  }

  async discoverAndLoadPlugins(): Promise<void> {
    try {
      await fs.access(this.deps.pluginsDir);
    } catch {
      return; // Plugins directory does not exist
    }

    const entries = await fs.readdir(this.deps.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.deps.pluginsDir, entry.name, "manifest.json");
      try {
        await fs.access(manifestPath);
      } catch {
        continue;
      }
      try {
        await this.loadPlugin(entry.name);
      } catch (err) {
        this.deps.logger.error(`Failed to load plugin ${entry.name}: ${(err as Error).message}`);
      }
    }
  }
}
