import { ComponentType } from "react";
import { Extension } from "@codemirror/state";
import {
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  EditorToolbarButtonRegistration,
  SettingsSectionRegistration,
  PageRegistration,
  NoteActionRegistration,
  CodeFenceRendererRegistration,
  EditorExtensionRegistration,
  CommandRegistration,
} from "./types";

export class PluginSlotRegistry {
  private sidebarPanels: SidebarPanelRegistration[] = [];
  private statusBarItems: StatusBarItemRegistration[] = [];
  private editorToolbarButtons: EditorToolbarButtonRegistration[] = [];
  private settingsSections: SettingsSectionRegistration[] = [];
  private pages: PageRegistration[] = [];
  private noteActions: NoteActionRegistration[] = [];
  private codeFenceRenderers = new Map<string, CodeFenceRendererRegistration>();
  private postProcessors: Array<{ pluginId: string; fn: (html: string) => string }> = [];
  private commands: CommandRegistration[] = [];
  private editorExtensions: EditorExtensionRegistration[] = [];
  private listeners = new Set<() => void>();

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Sidebar Panels ---

  registerSidebarPanel(
    pluginId: string,
    component: ComponentType,
    options: { id: string; title: string; icon: string; order?: number }
  ): void {
    this.sidebarPanels.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getSidebarPanels(): SidebarPanelRegistration[] {
    return [...this.sidebarPanels].sort((a, b) => a.order - b.order);
  }

  // --- Status Bar ---

  registerStatusBarItem(
    pluginId: string,
    component: ComponentType,
    options: { id: string; position: "left" | "right"; order?: number }
  ): void {
    this.statusBarItems.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getStatusBarItems(position: "left" | "right"): StatusBarItemRegistration[] {
    return this.statusBarItems
      .filter((i) => i.position === position)
      .sort((a, b) => a.order - b.order);
  }

  // --- Editor Toolbar ---

  registerEditorToolbarButton(
    pluginId: string,
    component: ComponentType,
    options: { id: string; order?: number }
  ): void {
    this.editorToolbarButtons.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getEditorToolbarButtons(): EditorToolbarButtonRegistration[] {
    return [...this.editorToolbarButtons].sort((a, b) => a.order - b.order);
  }

  // --- Settings ---

  registerSettingsSection(
    pluginId: string,
    component: ComponentType,
    options: { id: string; title: string }
  ): void {
    this.settingsSections.push({ ...options, pluginId, component });
    this.notify();
  }

  getSettingsSections(): SettingsSectionRegistration[] {
    return [...this.settingsSections];
  }

  // --- Pages ---

  registerPage(
    pluginId: string,
    component: ComponentType,
    options: {
      id: string;
      path: string;
      title: string;
      icon: string;
      showInSidebar?: boolean;
    }
  ): void {
    this.pages.push({
      ...options,
      pluginId,
      component,
      showInSidebar: options.showInSidebar ?? false,
    });
    this.notify();
  }

  getPages(): PageRegistration[] {
    return [...this.pages];
  }

  // --- Note Actions ---

  registerNoteAction(
    pluginId: string,
    options: { id: string; label: string; icon: string; onClick: (notePath: string) => void }
  ): void {
    this.noteActions.push({ ...options, pluginId });
    this.notify();
  }

  getNoteActions(): NoteActionRegistration[] {
    return [...this.noteActions];
  }

  // --- Code Fence Renderers ---

  registerCodeFenceRenderer(
    pluginId: string,
    language: string,
    component: ComponentType<{ content: string; notePath: string }>
  ): void {
    this.codeFenceRenderers.set(language, { language, pluginId, component });
    this.notify();
  }

  getCodeFenceRenderer(language: string): CodeFenceRendererRegistration | undefined {
    return this.codeFenceRenderers.get(language);
  }

  // --- Post Processors ---

  registerPostProcessor(pluginId: string, fn: (html: string) => string): void {
    this.postProcessors.push({ pluginId, fn });
  }

  getPostProcessors(): Array<(html: string) => string> {
    return this.postProcessors.map((p) => p.fn);
  }

  // --- Commands ---

  registerCommand(
    pluginId: string,
    command: { id: string; name: string; shortcut?: string; execute: () => void }
  ): void {
    this.commands.push({ ...command, pluginId });
    this.notify();
  }

  getCommands(): CommandRegistration[] {
    return [...this.commands];
  }

  // --- Editor Extensions ---

  registerEditorExtension(pluginId: string, extension: Extension): void {
    this.editorExtensions.push({ pluginId, extension });
    this.notify();
  }

  getEditorExtensions(): Extension[] {
    return this.editorExtensions.map((r) => r.extension);
  }

  // --- Cleanup ---

  removeAllForPlugin(pluginId: string): void {
    this.sidebarPanels = this.sidebarPanels.filter((r) => r.pluginId !== pluginId);
    this.statusBarItems = this.statusBarItems.filter((r) => r.pluginId !== pluginId);
    this.editorToolbarButtons = this.editorToolbarButtons.filter((r) => r.pluginId !== pluginId);
    this.settingsSections = this.settingsSections.filter((r) => r.pluginId !== pluginId);
    this.pages = this.pages.filter((r) => r.pluginId !== pluginId);
    this.noteActions = this.noteActions.filter((r) => r.pluginId !== pluginId);
    this.postProcessors = this.postProcessors.filter((r) => r.pluginId !== pluginId);
    this.commands = this.commands.filter((r) => r.pluginId !== pluginId);
    this.editorExtensions = this.editorExtensions.filter((r) => r.pluginId !== pluginId);

    for (const [lang, reg] of this.codeFenceRenderers) {
      if (reg.pluginId === pluginId) this.codeFenceRenderers.delete(lang);
    }

    this.notify();
  }
}
