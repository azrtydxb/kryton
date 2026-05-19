import type { ComponentType } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Registry manifest (matches kryton-plugins registry.json shape)
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  minKrytonVersion: string;
  tags: string[];
  icon: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Active plugin info (from server /plugins/active)
// ──────────────────────────────────────────────────────────────────────────────

export interface ActivePluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  /** URL to the plugin's client-side JS bundle. Null if server-only. */
  client: string | null;
  settings: Array<{
    key: string;
    type: string;
    default: unknown;
    label: string;
    perUser: boolean;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Built-in API value types (notes / storage)
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginNoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: PluginNoteEntry[];
}

export interface PluginNoteFile {
  path: string;
  content: string;
  title: string;
  modifiedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Slot registrations (mirrors packages/client/src/plugins/types.ts)
// ──────────────────────────────────────────────────────────────────────────────

export interface SidebarPanelRegistration {
  id: string;
  pluginId: string;
  title: string;
  icon: string;
  order: number;
  component: ComponentType;
}

export interface StatusBarItemRegistration {
  id: string;
  pluginId: string;
  position: "left" | "right";
  order: number;
  component: ComponentType;
}

export interface EditorToolbarButtonRegistration {
  id: string;
  pluginId: string;
  order: number;
  component: ComponentType;
}

export interface SettingsSectionRegistration {
  id: string;
  pluginId: string;
  title: string;
  component: ComponentType;
}

export interface PageRegistration {
  id: string;
  pluginId: string;
  path: string;
  title: string;
  icon: string;
  showInSidebar: boolean;
  component: ComponentType;
}

export interface NoteActionRegistration {
  id: string;
  pluginId: string;
  label: string;
  icon: string;
  onClick: (notePath: string) => void;
}

/**
 * A code fence's line range within the parsed note source.
 * 0-based, inclusive of both endpoints. `endLine` is the line containing
 * the closing fence (```), `startLine` the line with the opening fence.
 */
export interface CodeFenceRange {
  startLine: number;
  endLine: number;
}

export interface CodeFenceRendererProps {
  /** The fence body (without the surrounding ``` lines). */
  content: string;
  /** Path of the host note. May be empty when no path is known. */
  notePath: string;
  /**
   * Range of the entire fence (including opening + closing ``` lines)
   * in the PARSED note source — i.e. after frontmatter stripping and
   * wikilink-embed substitution. Undefined when source position data is
   * not available (e.g. when the renderer is invoked outside the
   * markdown pipeline).
   *
   * Plugins that round-trip a fence to disk (kanban, excalidraw, …)
   * should prefer `rawRange` so they can pass the line numbers straight
   * to `api.notes.replaceFenceAtRange`.
   */
  range?: CodeFenceRange;
  /**
   * Range of the entire fence (including opening + closing ``` lines)
   * in the RAW on-disk content — i.e. the same coordinate space as the
   * string returned by `api.notes.get(path).content`. Suitable for use
   * with `api.notes.replaceFenceAtRange` without any further adjustment.
   * Undefined when the renderer is invoked outside the markdown pipeline
   * or when the fence can't be located in the raw source (e.g. the body
   * has been transformed by a remark plugin).
   */
  rawRange?: CodeFenceRange;
  /**
   * Full original fence block including the surrounding ``` markers.
   * Undefined when source position data is not available.
   */
  source?: string;
}

export interface CodeFenceRendererRegistration {
  language: string;
  pluginId: string;
  component: ComponentType<CodeFenceRendererProps>;
}

export interface CommandRegistration {
  id: string;
  pluginId: string;
  name: string;
  shortcut?: string;
  execute: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Plugin API surface exposed to client plugins via activate(api)
// ──────────────────────────────────────────────────────────────────────────────

export interface ClientPluginAPI {
  ui: {
    registerSidebarPanel(
      component: ComponentType,
      options: { id: string; title: string; icon: string; order?: number }
    ): void;
    registerStatusBarItem(
      component: ComponentType,
      options: { id: string; position: "left" | "right"; order?: number }
    ): void;
    registerEditorToolbarButton(
      component: ComponentType,
      options: { id: string; order?: number }
    ): void;
    registerSettingsSection(
      component: ComponentType,
      options: { id: string; title: string }
    ): void;
    registerPage(
      component: ComponentType,
      options: {
        id: string;
        path: string;
        title: string;
        icon: string;
        showInSidebar?: boolean;
      }
    ): void;
    registerNoteAction(options: {
      id: string;
      label: string;
      icon: string;
      onClick: (notePath: string) => void;
    }): void;
    /**
     * Close the currently focused note pane (Cmd+W intent). No-op when
     * no pane is open or the host has not registered a closePane hook.
     */
    closePane(): void;
  };
  markdown: {
    registerCodeFenceRenderer(
      language: string,
      component: ComponentType<CodeFenceRendererProps>
    ): void;
    registerPostProcessor(fn: (html: string) => string): void;
  };
  commands: {
    register(command: {
      id: string;
      name: string;
      shortcut?: string;
      execute: () => void;
    }): void;
  };
  context: {
    useCurrentUser(): { id: string; name: string; email: string } | null;
    useCurrentNote(): { path: string; content: string } | null;
    useTheme(): "light" | "dark";
    usePluginSettings(key: string): unknown;
  };
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>;
  };
  notes: {
    list(folder?: string): Promise<PluginNoteEntry[]>;
    get(path: string): Promise<PluginNoteFile>;
    getContent(path: string): Promise<string>;
    create(path: string, content: string): Promise<{ ok: true }>;
    update(path: string, content: string): Promise<{ ok: true }>;
    delete(path: string): Promise<{ ok: true }>;
    openByPath(path: string): Promise<{ ok: true }>;
    replaceFenceAtRange(
      path: string,
      range: { startLine: number; endLine: number },
      newSource: string,
    ): Promise<{ ok: true }>;
    /**
     * Persist the currently focused editor buffer via the host's save
     * pipeline. Resolves with the saved path + ISO timestamp. Rejects
     * when no editor is focused or when the host has not registered a
     * saveCurrent hook.
     */
    saveCurrent(): Promise<{ path: string; savedAt: string }>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true }>;
    list(prefix?: string): Promise<
      Array<{ key: string; value: unknown; userId: string | null }>
    >;
  };
  editor: {
    registerPlugin(
      plugin: import("../editor/state").EditorPlugin,
    ): () => void;
    getActiveState(): import("../editor/state").EditorState | null;
    dispatch(tr: import("../editor/state").Transaction): void;
    onTransaction(
      cb: (
        tr: import("../editor/state").Transaction,
        state: import("../editor/state").EditorState,
      ) => void,
    ): () => void;
  };
  notify: {
    info(message: string): void;
    success(message: string): void;
    error(message: string): void;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Client plugin module shape (what plugins export)
// ──────────────────────────────────────────────────────────────────────────────

export interface ClientPluginModule {
  activate(api: ClientPluginAPI): void;
  deactivate?(): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// window.__krytonPluginDeps — injected by PluginRoot for plugin bundles
// ──────────────────────────────────────────────────────────────────────────────

export interface KrytonPluginDeps {
  React: typeof import("react");
  ReactDOM: typeof import("react-dom");
}

declare global {
  interface Window {
    __krytonPluginDeps: KrytonPluginDeps;
  }
}
