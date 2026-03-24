import React from "react";
import { PluginErrorBoundary } from "../../plugins/PluginErrorBoundary";
import { usePluginSlots } from "../../plugins/PluginContext";

interface PluginSlotProps {
  slot: "sidebar" | "statusbar-left" | "statusbar-right" | "editor-toolbar";
}

export function PluginSlot({ slot }: PluginSlotProps) {
  const plugins = usePluginSlots();

  let items: Array<{ id: string; pluginId: string; component: React.ComponentType; title?: string }> = [];

  switch (slot) {
    case "sidebar":
      items = plugins.sidebarPanels.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
        title: p.title,
      }));
      break;
    case "statusbar-left":
      items = plugins.statusBarLeft.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
    case "statusbar-right":
      items = plugins.statusBarRight.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
    case "editor-toolbar":
      items = plugins.editorToolbarButtons.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
  }

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <PluginErrorBoundary
          key={item.id}
          pluginId={item.pluginId}
          pluginName={item.title || item.pluginId}
        >
          <item.component />
        </PluginErrorBoundary>
      ))}
    </>
  );
}
