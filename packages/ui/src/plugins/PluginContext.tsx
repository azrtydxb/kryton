import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type {
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  EditorToolbarButtonRegistration,
  TopbarActionRegistration,
  PageRegistration,
  NoteActionRegistration,
  CommandRegistration,
  CodeFenceRendererRegistration,
} from "./types";
import type { PluginSlotRegistry } from "./registry";

// ──────────────────────────────────────────────────────────────────────────────
// Context value shape — all currently registered slot contents
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginContextValue {
  registry: PluginSlotRegistry;
  sidebarPanels: SidebarPanelRegistration[];
  statusBarLeft: StatusBarItemRegistration[];
  statusBarRight: StatusBarItemRegistration[];
  editorToolbarButtons: EditorToolbarButtonRegistration[];
  topbarActions: TopbarActionRegistration[];
  pages: PageRegistration[];
  noteActions: NoteActionRegistration[];
  commands: CommandRegistration[];
  getCodeFenceRenderer: (lang: string) => CodeFenceRendererRegistration | undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────────────────────────────────────

const PluginCtx = createContext<PluginContextValue | null>(null);

// ──────────────────────────────────────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────────────────────────────────────

export function PluginProvider({
  registry,
  children,
}: {
  registry: PluginSlotRegistry;
  children: ReactNode;
}) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    return registry.subscribe(() => setVersion((v) => v + 1));
  }, [registry]);

  const value: PluginContextValue = {
    registry,
    sidebarPanels: registry.getSidebarPanels(),
    statusBarLeft: registry.getStatusBarItems("left"),
    statusBarRight: registry.getStatusBarItems("right"),
    editorToolbarButtons: registry.getEditorToolbarButtons(),
    topbarActions: registry.getTopbarActions(),
    pages: registry.getPages(),
    noteActions: registry.getNoteActions(),
    commands: registry.getCommands(),
    getCodeFenceRenderer: (lang) => registry.getCodeFenceRenderer(lang),
  };

  return <PluginCtx.Provider value={value}>{children}</PluginCtx.Provider>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Consumer hook
// ──────────────────────────────────────────────────────────────────────────────

export function usePluginSlots(): PluginContextValue {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("usePluginSlots must be used within <PluginProvider>");
  }
  return ctx;
}
