import path from "path";
import fs from "fs";
import { PluginManifest, PluginInstance, PluginModule } from "./types";
import { PluginEventBus } from "./PluginEventBus";
import { PluginRouter } from "./PluginRouter";
import { PluginHealthMonitor } from "./PluginHealthMonitor";
import { PluginApiFactory } from "./PluginApiFactory";

interface PluginManagerDeps {
  pluginsDir: string;
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  apiFactory: PluginApiFactory;
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

  async loadPlugin(pluginId: string): Promise<void> {
    const pluginDir = path.join(this.deps.pluginsDir, pluginId);
    const manifestPath = path.join(pluginDir, "manifest.json");

    const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
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
      return;
    }

    // Load module
    const serverEntry = path.resolve(pluginDir, manifest.server);
    try {
      // Clear require cache for hot-reload
      delete require.cache[require.resolve(serverEntry)];
    } catch {
      // Not cached yet
    }

    let mod: PluginModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(serverEntry) as PluginModule;
      instance.module = mod;
      instance.state = "loaded";
    } catch (err) {
      instance.state = "error";
      instance.error = `Failed to load: ${(err as Error).message}`;
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
            this.activationTimeoutMs
          )
        ),
      ]);
      instance.state = "active";
    } catch (err) {
      instance.state = "error";
      instance.error = `Activation failed: ${(err as Error).message}`;
      // Clean up any partial registrations
      this.deps.eventBus.removeAllForPlugin(pluginId);
      this.deps.pluginRouter.removeAllForPlugin(pluginId);
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    instance.state = "deactivating";

    // Call deactivate if module exists
    if (instance.module?.deactivate) {
      try {
        await Promise.resolve(instance.module.deactivate());
      } catch {
        // Best effort
      }
    }

    // Clean up registrations
    this.deps.eventBus.removeAllForPlugin(pluginId);
    this.deps.pluginRouter.removeAllForPlugin(pluginId);
    this.deps.healthMonitor.reset(pluginId);

    // Clear require cache
    if (instance.manifest.server) {
      const serverEntry = path.resolve(
        this.deps.pluginsDir,
        pluginId,
        instance.manifest.server
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
  }

  async disablePlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
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
    if (!fs.existsSync(this.deps.pluginsDir)) return;

    const entries = fs.readdirSync(this.deps.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.deps.pluginsDir, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        await this.loadPlugin(entry.name);
      } catch (err) {
        console.error(`[plugins] Failed to load plugin ${entry.name}:`, err);
      }
    }
  }
}
