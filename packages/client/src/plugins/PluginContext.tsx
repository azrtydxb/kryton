import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { PluginSlotRegistry } from "./PluginSlotRegistry";
import {
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  EditorToolbarButtonRegistration,
  PageRegistration,
  NoteActionRegistration,
  CommandRegistration,
  CodeFenceRendererRegistration,
} from "./types";

interface PluginContextValue {
  registry: PluginSlotRegistry;
  sidebarPanels: SidebarPanelRegistration[];
  statusBarLeft: StatusBarItemRegistration[];
  statusBarRight: StatusBarItemRegistration[];
  editorToolbarButtons: EditorToolbarButtonRegistration[];
  pages: PageRegistration[];
  noteActions: NoteActionRegistration[];
  commands: CommandRegistration[];
  getCodeFenceRenderer: (lang: string) => CodeFenceRendererRegistration | undefined;
}

const PluginCtx = createContext<PluginContextValue | null>(null);

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
    pages: registry.getPages(),
    noteActions: registry.getNoteActions(),
    commands: registry.getCommands(),
    getCodeFenceRenderer: (lang) => registry.getCodeFenceRenderer(lang),
  };

  return <PluginCtx.Provider value={value}>{children}</PluginCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePluginSlots(): PluginContextValue {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("usePluginSlots must be used within PluginProvider");
  }
  return ctx;
}
