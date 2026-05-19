import {
  PluginSlotRegistry,
  registerEditorPlugin,
  getActiveEditorState,
  dispatchToActiveEditor,
  subscribeEditorTransactions,
  setEditorOption,
  getHostHooks,
} from "@azrtydxb/ui";
import { ClientPluginAPI, ClientPluginModule, ActivePluginInfo } from "./types";
import { request } from "../lib/api";

export class ClientPluginManager {
  private onGraphUpdatedCallbacks: (() => void)[] = [];

  /**
   * Register a callback to be called when the server broadcasts a graph:updated event.
   * Used to invalidate the graph query cache for real-time updates.
   */
  onGraphUpdated(callback: () => void): () => void {
    this.onGraphUpdatedCallbacks.push(callback);
    return () => {
      this.onGraphUpdatedCallbacks = this.onGraphUpdatedCallbacks.filter((cb) => cb !== callback);
    };
  }
  private registry: PluginSlotRegistry;
  private loadedPlugins = new Map<string, ClientPluginModule>();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectDelayMs = 3000;
  private loaded = false;

  constructor(registry: PluginSlotRegistry) {
    this.registry = registry;
  }

  async loadActivePlugins(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

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
        const { event: evtName, data } = JSON.parse(event.data as string) as { event: string; data: { id?: string; client?: string } };
        if (evtName === "graph:updated") {
          this.onGraphUpdatedCallbacks.forEach((cb) => cb());
        } else {
          this.handlePluginEvent(evtName, data as { id: string; client?: string });
        }
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
      notes: buildNotesApi(),
      storage: buildStorageApi(pluginId),
      editor: {
        registerPlugin: (plugin) => registerEditorPlugin(plugin),
        getActiveState: () => getActiveEditorState(),
        dispatch: (tr) => dispatchToActiveEditor(tr),
        onTransaction: (cb) => subscribeEditorTransactions(cb),
        setOption: (name, value) => setEditorOption(name, value),
      },
      notify: {
        info: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        success: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        error: (msg) => console.error(`[plugin:${pluginId}]`, msg),
      },
    };
  }
}

// ── api.notes / api.storage wrappers (delegate to /api/plugin-builtin/*) ──

async function builtinFetch(path: string, options?: RequestInit): Promise<Response> {
  const r = await fetch(`/api/plugin-builtin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",
  });
  return r;
}

function buildNotesApi(): ClientPluginAPI["notes"] {
  return {
    list: async (folder?: string) => {
      const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const r = await builtinFetch(`/notes/list${qs}`);
      if (!r.ok) throw new Error(`notes.list failed: ${r.status}`);
      return await r.json();
    },
    get: async (path: string) => {
      const r = await builtinFetch(`/notes/get?path=${encodeURIComponent(path)}`);
      if (!r.ok) throw new Error(`notes.get failed: ${r.status}`);
      return await r.json();
    },
    getContent: async (path: string) => {
      const n = await (async () => {
        const r = await builtinFetch(`/notes/get?path=${encodeURIComponent(path)}`);
        if (!r.ok) throw new Error(`notes.getContent failed: ${r.status}`);
        return await r.json();
      })();
      return (n as { content: string }).content;
    },
    create: async (path: string, content: string) => {
      const r = await builtinFetch(`/notes/create`, { method: "POST", body: JSON.stringify({ path, content }) });
      if (!r.ok) throw new Error(`notes.create failed: ${r.status}`);
    },
    update: async (path: string, content: string) => {
      const r = await builtinFetch(`/notes/update`, { method: "POST", body: JSON.stringify({ path, content }) });
      if (!r.ok) throw new Error(`notes.update failed: ${r.status}`);
    },
    delete: async (path: string) => {
      const r = await builtinFetch(`/notes/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`notes.delete failed: ${r.status}`);
    },
    openByPath: async (path: string) => {
      const r = await builtinFetch(`/notes/openByPath`, { method: "POST", body: JSON.stringify({ path }) });
      if (!r.ok) throw new Error(`notes.openByPath failed: ${r.status}`);
    },
    replaceFenceAtRange: async (path, range, newSource) => {
      const r = await builtinFetch(`/notes/replaceFenceAtRange`, {
        method: "POST",
        body: JSON.stringify({ path, range, newSource }),
      });
      if (!r.ok) throw new Error(`notes.replaceFenceAtRange failed: ${r.status}`);
    },
    saveCurrent: async () => {
      const hooks = getHostHooks();
      if (!hooks.saveCurrent) throw new Error("No active editor to save");
      return await hooks.saveCurrent();
    },
  };
}

function buildStorageApi(pluginId: string): ClientPluginAPI["storage"] {
  const headers = { "X-Kryton-Plugin-Id": pluginId };
  return {
    get: async (key: string) => {
      const r = await builtinFetch(`/storage/get?key=${encodeURIComponent(key)}`, { headers });
      if (!r.ok) throw new Error(`storage.get failed: ${r.status}`);
      const body = await r.json();
      return body?.value ?? null;
    },
    set: async (key: string, value: unknown) => {
      const r = await builtinFetch(`/storage/set`, { method: "POST", headers, body: JSON.stringify({ key, value }) });
      if (!r.ok) throw new Error(`storage.set failed: ${r.status}`);
    },
    delete: async (key: string) => {
      const r = await builtinFetch(`/storage/delete?key=${encodeURIComponent(key)}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error(`storage.delete failed: ${r.status}`);
    },
    list: async (prefix?: string) => {
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      const r = await builtinFetch(`/storage/list${qs}`, { headers });
      if (!r.ok) throw new Error(`storage.list failed: ${r.status}`);
      return await r.json();
    },
  };
}
