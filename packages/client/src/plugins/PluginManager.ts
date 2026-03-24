import { PluginSlotRegistry } from "./PluginSlotRegistry";
import { ClientPluginAPI, ClientPluginModule, ActivePluginInfo } from "./types";
import { request } from "../lib/api";

export class ClientPluginManager {
  private registry: PluginSlotRegistry;
  private loadedPlugins = new Map<string, ClientPluginModule>();

  constructor(registry: PluginSlotRegistry) {
    this.registry = registry;
  }

  async loadActivePlugins(): Promise<void> {
    const plugins = await request<ActivePluginInfo[]>("/plugins/active");

    for (const plugin of plugins) {
      if (!plugin.client) continue;
      try {
        await this.loadPlugin(plugin);
      } catch (err) {
        console.error(`[plugins] Failed to load client plugin: ${plugin.id}`, err);
      }
    }
  }

  private async loadPlugin(info: ActivePluginInfo): Promise<void> {
    const module: ClientPluginModule = await import(
      /* @vite-ignore */ info.client!
    );

    const api = this.createClientApi(info.id);
    module.activate(api);
    this.loadedPlugins.set(info.id, module);
  }

  unloadPlugin(pluginId: string): void {
    const module = this.loadedPlugins.get(pluginId);
    if (module?.deactivate) {
      module.deactivate();
    }
    this.registry.removeAllForPlugin(pluginId);
    this.loadedPlugins.delete(pluginId);
  }

  private createClientApi(pluginId: string): ClientPluginAPI {
    const registry = this.registry;

    return {
      ui: {
        registerSidebarPanel: (component, options) =>
          registry.registerSidebarPanel(pluginId, component, options),
        registerStatusBarItem: (component, options) =>
          registry.registerStatusBarItem(pluginId, component, options),
        registerEditorToolbarButton: (component, options) =>
          registry.registerEditorToolbarButton(pluginId, component, options),
        registerSettingsSection: (component, options) =>
          registry.registerSettingsSection(pluginId, component, options),
        registerPage: (component, options) =>
          registry.registerPage(pluginId, component, options),
        registerNoteAction: (options) =>
          registry.registerNoteAction(pluginId, options),
      },
      markdown: {
        registerCodeFenceRenderer: (language, component) =>
          registry.registerCodeFenceRenderer(pluginId, language, component),
        registerPostProcessor: (fn) =>
          registry.registerPostProcessor(pluginId, fn),
      },
      commands: {
        register: (command) => registry.registerCommand(pluginId, command),
      },
      context: {
        useCurrentUser: () => {
          // Will be connected to AuthContext in integration
          return null;
        },
        useCurrentNote: () => {
          // Will be connected to useNotes in integration
          return null;
        },
        useTheme: () => {
          // Will be connected to useTheme in integration
          return "dark";
        },
        usePluginSettings: () => {
          // Will be connected to settings API in integration
          return null;
        },
      },
      api: {
        fetch: (path, options) => {
          const url = `/api/plugins/${pluginId}${path}`;
          return fetch(url, {
            ...options,
            headers: {
              ...options?.headers,
              "X-Requested-With": "XMLHttpRequest",
            },
            credentials: "include",
          });
        },
      },
      notify: {
        info: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        success: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        error: (msg) => console.error(`[plugin:${pluginId}]`, msg),
      },
    };
  }
}
