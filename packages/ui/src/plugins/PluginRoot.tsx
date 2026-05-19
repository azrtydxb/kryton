import React, {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as ReactDOM from "react-dom";
import { PluginProvider } from "./PluginContext";
import { PluginSlotRegistry } from "./registry";
import { loadPlugin } from "./loader";
import {
  dispatchToActiveEditor,
  getActiveEditorState,
  registerEditorPlugin,
  subscribeEditorTransactions,
} from "./editor-registry";
import { getHostHooks } from "./host-hooks";
import type { ActivePluginInfo, ClientPluginAPI, ClientPluginModule } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// PluginRoot
//
// Mount inside <KrytonDataProvider>. Responsibilities:
//  1. Set window.__krytonPluginDeps so plugin bundles can access React/ReactDOM.
//  2. Load & activate each enabled plugin via loadPlugin().
//  3. Expose the PluginSlotRegistry via PluginContext.
//  4. Unload (deactivate + remove slots) when a plugin is removed or on unmount.
//
// Props:
//  - activePlugins: list from the server (/plugins/active endpoint). The host
//    app is responsible for fetching this and passing it in. PluginRoot is
//    pure – it does not fetch.
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginRootProps {
  /** Active plugins fetched from /plugins/active. */
  activePlugins: ActivePluginInfo[];
  children: ReactNode;
}

export function PluginRoot({ activePlugins, children }: PluginRootProps) {
  // Stable registry instance — created once for this PluginRoot mount.
  const registry = useMemo(() => new PluginSlotRegistry(), []);

  // Track loaded modules by plugin id so we can deactivate on cleanup.
  const loadedRef = useRef<Map<string, ClientPluginModule>>(new Map());

  // ── 1. Inject window.__krytonPluginDeps ────────────────────────────────────

  useEffect(() => {
    window.__krytonPluginDeps = {
      React,
      ReactDOM,
    };
    // Nothing to clean up — deps remain available for the lifetime of the app.
  }, []);

  // ── 2. Load / unload plugins when activePlugins list changes ───────────────

  useEffect(() => {
    let cancelled = false;
    const loaded = loadedRef.current;

    // Build the set of ids we want active.
    const desiredIds = new Set(activePlugins.map((p) => p.id));

    // Unload plugins no longer in the desired set.
    for (const [id, mod] of loaded) {
      if (!desiredIds.has(id)) {
        try {
          mod.deactivate?.();
        } catch (err) {
          console.error(`[plugins] deactivate failed for ${id}:`, err);
        }
        registry.removeAllForPlugin(id);
        loaded.delete(id);
      }
    }

    // Load new plugins.
    const pending = activePlugins.filter(
      (p) => p.client && !loaded.has(p.id)
    );

    Promise.allSettled(
      pending.map(async (info) => {
        if (cancelled) return;
        try {
          const mod = await loadPlugin(
            {
              id: info.id,
              name: info.name,
              description: info.description,
              author: "",
              version: info.version,
              minKrytonVersion: "",
              tags: [],
              icon: "",
            },
            (pluginId) => buildClientApi(pluginId, registry, info),
            info.client!
          );
          if (!cancelled && mod) {
            loaded.set(info.id, mod);
          }
        } catch (err) {
          console.error(`[plugins] failed to load plugin ${info.id}:`, err);
        }
      })
    );

    return () => {
      cancelled = true;
    };
    // Re-run whenever the active list changes (shallow compare by id+version).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlugins.map((p) => `${p.id}@${p.version}`).join(","), registry]);

  // ── 3. Cleanup on unmount ──────────────────────────────────────────────────

  useEffect(() => {
    const loaded = loadedRef.current;
    return () => {
      for (const [id, mod] of loaded) {
        try {
          mod.deactivate?.();
        } catch {
          // ignore
        }
        registry.removeAllForPlugin(id);
        loaded.delete(id);
      }
    };
  }, [registry]);

  // ── 4. Render ──────────────────────────────────────────────────────────────

  return <PluginProvider registry={registry}>{children}</PluginProvider>;
}

// ──────────────────────────────────────────────────────────────────────────────
// API factory — mirrors ClientPluginManager.createClientApi() in packages/client
// ──────────────────────────────────────────────────────────────────────────────

async function jsonFetch<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  // 204 / empty body → return null cast.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function buildNotesApi(): ClientPluginAPI["notes"] {
  const base = "/api/plugin-builtin/notes";
  const get = (path: string) =>
    jsonFetch<{
      path: string;
      content: string;
      title: string;
      modifiedAt: string;
    }>(`${base}/get?path=${encodeURIComponent(path)}`);

  return {
    list: (folder?: string) =>
      jsonFetch(
        `${base}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
      ),
    get,
    getContent: async (path: string) => (await get(path)).content,
    create: (path: string, content: string) =>
      jsonFetch(`${base}/create`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
        headers: { "Content-Type": "application/json" },
      }),
    update: (path: string, content: string) =>
      jsonFetch(`${base}/update`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
        headers: { "Content-Type": "application/json" },
      }),
    delete: (path: string) =>
      jsonFetch(`${base}/delete?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
    openByPath: (path: string) =>
      jsonFetch(`${base}/openByPath`, {
        method: "POST",
        body: JSON.stringify({ path }),
        headers: { "Content-Type": "application/json" },
      }),
    replaceFenceAtRange: (path, range, newSource) =>
      jsonFetch(`${base}/replaceFenceAtRange`, {
        method: "POST",
        body: JSON.stringify({ path, range, newSource }),
        headers: { "Content-Type": "application/json" },
      }),
    saveCurrent: () => {
      const hook = getHostHooks().saveCurrent;
      if (!hook) {
        return Promise.reject(
          new Error("notes.saveCurrent: no host save handler registered"),
        );
      }
      return hook();
    },
  };
}

function buildStorageApi(pluginId: string): ClientPluginAPI["storage"] {
  const base = "/api/plugin-builtin/storage";
  const headers = { "X-Kryton-Plugin-Id": pluginId };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  return {
    get: async (key: string) => {
      const r = await jsonFetch<{ value: unknown }>(
        `${base}/get?key=${encodeURIComponent(key)}`,
        { headers },
      );
      return r.value;
    },
    set: (key: string, value: unknown) =>
      jsonFetch(`${base}/set`, {
        method: "POST",
        body: JSON.stringify({ key, value }),
        headers: jsonHeaders,
      }),
    delete: (key: string) =>
      jsonFetch(`${base}/delete?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers,
      }),
    list: (prefix?: string) =>
      jsonFetch(
        `${base}/list${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`,
        { headers },
      ),
  };
}

function buildEditorApi(): ClientPluginAPI["editor"] {
  return {
    registerPlugin: (plugin) => registerEditorPlugin(plugin),
    getActiveState: () => getActiveEditorState(),
    dispatch: (tr) => dispatchToActiveEditor(tr),
    onTransaction: (cb) => subscribeEditorTransactions(cb),
  };
}

export function buildClientApi(
  pluginId: string,
  registry: PluginSlotRegistry,
  _info: ActivePluginInfo,
): ClientPluginAPI {
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
      closePane: () => {
        const hook = getHostHooks().closePane;
        if (hook) hook();
      },
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
      useCurrentUser: () => null,
      useCurrentNote: () => null,
      useTheme: () => "dark",
      usePluginSettings: (_key) => null,
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
    editor: buildEditorApi(),
    notify: {
      info: (msg) => console.log(`[plugin:${pluginId}]`, msg),
      success: (msg) => console.log(`[plugin:${pluginId}]`, msg),
      error: (msg) => console.error(`[plugin:${pluginId}]`, msg),
    },
  };
}
