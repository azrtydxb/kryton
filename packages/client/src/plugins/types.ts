import { ComponentType } from "react";
import type {
  EditorPlugin,
  EditorState,
  Transaction as EditorTransaction,
  EditorOptionValue,
} from "@azrtydxb/ui";

export type { EditorPlugin };

// Note shape returned by api.notes.get
export interface PluginNote {
  path: string;
  content: string;
  title: string;
  modifiedAt: string;
}

export interface PluginNoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: PluginNoteEntry[];
}

export interface PluginStorageEntry {
  key: string;
  value: unknown;
  userId: string | null;
}

// --- UI Slot Types ---

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

export interface CodeFenceRange {
  startLine: number;
  endLine: number;
}

export interface CodeFenceRendererProps {
  content: string;
  notePath: string;
  range?: CodeFenceRange;
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

// --- Client Plugin API ---

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
    registerTopbarAction(
      component: ComponentType,
      options: { id: string; order?: number }
    ): void;
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
    setPluginSetting(key: string, value: unknown): Promise<void>;
  };
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>;
  };
  notes: {
    list(folder?: string): Promise<PluginNoteEntry[]>;
    get(path: string): Promise<PluginNote>;
    getContent(path: string): Promise<string>;
    create(path: string, content: string): Promise<void>;
    update(path: string, content: string): Promise<void>;
    delete(path: string): Promise<void>;
    openByPath(path: string): Promise<void>;
    replaceFenceAtRange(
      path: string,
      range: { startLine: number; endLine: number },
      newSource: string
    ): Promise<void>;
    saveCurrent(): Promise<{ path: string; savedAt: string }>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<PluginStorageEntry[]>;
  };
  editor: {
    registerPlugin(plugin: EditorPlugin): () => void;
    getActiveState(): EditorState | null;
    dispatch(tr: EditorTransaction): void;
    onTransaction(cb: (tr: EditorTransaction, state: EditorState) => void): () => void;
    setOption(name: string, value: EditorOptionValue): void;
  };
  notify: {
    info(message: string): void;
    success(message: string): void;
    error(message: string): void;
  };
}

// --- Client Plugin Module ---

export interface ClientPluginModule {
  activate(api: ClientPluginAPI): void;
  deactivate?(): void;
}

// --- Active Plugin Info (from server) ---

export interface ActivePluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  client: string | null;
  settings: Array<{
    key: string;
    type: string;
    default: unknown;
    label: string;
    perUser: boolean;
  }>;
}
