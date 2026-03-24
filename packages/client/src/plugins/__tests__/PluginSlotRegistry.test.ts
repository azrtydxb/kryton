import { describe, it, expect, beforeEach } from "vitest";
import { PluginSlotRegistry } from "../PluginSlotRegistry";

describe("PluginSlotRegistry", () => {
  let registry: PluginSlotRegistry;

  beforeEach(() => {
    registry = new PluginSlotRegistry();
  });

  it("registers and retrieves sidebar panels", () => {
    const TestComponent = () => null;
    registry.registerSidebarPanel("test-plugin", TestComponent, {
      id: "panel-1",
      title: "Test Panel",
      icon: "layout",
    });

    const panels = registry.getSidebarPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].title).toBe("Test Panel");
    expect(panels[0].pluginId).toBe("test-plugin");
  });

  it("registers pages", () => {
    const TestPage = () => null;
    registry.registerPage("test-plugin", TestPage, {
      id: "page-1",
      path: "/kanban",
      title: "Kanban",
      icon: "layout-grid",
      showInSidebar: true,
    });

    const pages = registry.getPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe("/kanban");
  });

  it("registers code fence renderers", () => {
    const Renderer = () => null;
    registry.registerCodeFenceRenderer("test-plugin", "kanban", Renderer);

    const renderer = registry.getCodeFenceRenderer("kanban");
    expect(renderer).toBeDefined();
    expect(renderer?.component).toBe(Renderer);
  });

  it("removes all registrations for a plugin", () => {
    const Component = () => null;
    registry.registerSidebarPanel("plugin-a", Component, {
      id: "a",
      title: "A",
      icon: "x",
    });
    registry.registerSidebarPanel("plugin-b", Component, {
      id: "b",
      title: "B",
      icon: "x",
    });

    registry.removeAllForPlugin("plugin-a");

    const panels = registry.getSidebarPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].pluginId).toBe("plugin-b");
  });

  it("sorts registrations by order", () => {
    const A = () => null;
    const B = () => null;
    registry.registerSidebarPanel("p", A, {
      id: "a",
      title: "A",
      icon: "x",
      order: 10,
    });
    registry.registerSidebarPanel("p", B, {
      id: "b",
      title: "B",
      icon: "x",
      order: 1,
    });

    const panels = registry.getSidebarPanels();
    expect(panels[0].id).toBe("b");
    expect(panels[1].id).toBe("a");
  });

  it("registers commands", () => {
    const execute = () => {};
    registry.registerCommand("test-plugin", {
      id: "cmd-1",
      name: "Do Thing",
      shortcut: "Ctrl+Shift+K",
      execute,
    });

    const commands = registry.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("Do Thing");
  });
});
