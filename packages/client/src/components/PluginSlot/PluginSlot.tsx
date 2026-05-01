import React from "react";
import { usePluginSlots } from "@azrtydxb/ui";
import { PluginErrorBoundary } from "../../plugins/PluginErrorBoundary";

interface PluginSlotProps {
  slot: "sidebar" | "statusbar-left" | "statusbar-right" | "editor-toolbar";
}

/**
 * Renders components registered by plugins into a named slot.
 * Uses @azrtydxb/ui usePluginSlots (ui's PluginProvider must be an ancestor).
 * Error isolation per plugin is provided by the client's PluginErrorBoundary.
 */
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
