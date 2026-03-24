import { PluginSlotRegistry } from "./PluginSlotRegistry";
import { ClientPluginAPI, ClientPluginModule, ActivePluginInfo } from "./types";
import { request } from "../lib/api";

export class ClientPluginManager {
  private registry: PluginSlotRegistry;
  private loadedPlugins = new Map<string, ClientPluginModule>();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectDelayMs = 3000;

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

    this.connectWebSocket();
  }

  connectWebSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/plugins`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error("[plugins] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      console.log("[plugins] WebSocket connected");
      if (this.wsReconnectTimer !== null) {
        clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = null;
      }
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const { event: evtName, data } = JSON.parse(event.data as string) as { event: string; data: { id: string; client?: string } };
        this.handlePluginEvent(evtName, data);
      } catch (err) {
        console.warn("[plugins] Failed to parse WebSocket message:", err);
      }
    });

    this.ws.addEventListener("close", () => {
      console.log("[plugins] WebSocket disconnected — will reconnect");
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (err) => {
      console.error("[plugins] WebSocket error:", err);
    });
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer !== null) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWebSocket();
    }, this.wsReconnectDelayMs);
  }

  private handlePluginEvent(event: string, data: { id: string; client?: string }): void {
    const pluginId = data.id;
    if (event === "plugin:activated") {
      // Unload existing version first (hot-swap), then reload from server
      if (this.loadedPlugins.has(pluginId)) {
        this.unloadPlugin(pluginId);
      }
      request<ActivePluginInfo[]>("/plugins/active")
        .then((plugins) => {
          const info = plugins.find((p) => p.id === pluginId);
          if (info?.client) {
            this.loadPlugin(info).catch((err) => {
              console.error(`[plugins] Hot-swap reload failed for ${pluginId}:`, err);
            });
          }
        })
        .catch((err) => console.error("[plugins] Failed to fetch active plugins after hot-swap:", err));
    } else if (event === "plugin:deactivated") {
      this.unloadPlugin(pluginId);
    } else if (event === "plugin:error") {
      console.warn(`[plugins] Server reported error for plugin ${pluginId}`);
      this.unloadPlugin(pluginId);
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
      editor: {
        registerExtension: (extension) =>
          registry.registerEditorExtension(pluginId, extension),
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
