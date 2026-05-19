import React from "react";
import { usePluginSlots } from "@azrtydxb/ui";
import { PluginErrorBoundary } from "../../plugins/PluginErrorBoundary";
import { PluginSection } from "./PluginSection";
import { useSidebarSides, getPref, type Side } from "../../plugins/sidebarPrefs";

interface PluginSlotProps {
  slot:
    | "sidebar"
    | "statusbar-left"
    | "statusbar-right"
    | "editor-toolbar"
    | "topbar-actions";
  /**
   * When slot==='sidebar', filter the registered panels to those the
   * user has placed on this side. Defaults to 'left' so existing call
   * sites that don't pass a side keep their current behavior.
   */
  side?: Side;
}

/**
 * Renders components registered by plugins into a named slot.
 * Uses @azrtydxb/ui usePluginSlots (ui's PluginProvider must be an ancestor).
 * Error isolation per plugin is provided by the client's PluginErrorBoundary.
 *
 * For the 'sidebar' slot, the panels are filtered by user-chosen side
 * (left/right) and wrapped in a PluginSection that overlays a move-arrow
 * button so the user can swap any panel between rails.
 */
export function PluginSlot({ slot, side }: PluginSlotProps) {
  const plugins = usePluginSlots();
  // Subscribe to side-pref changes — this re-renders the slot when any
  // plugin is moved, so both the left and right slot views update in
  // lock-step. The returned map is unused; we look up per-plugin via
  // getSide so reads stay obviously correct at the call site.
  useSidebarSides();

  let items: Array<{ id: string; pluginId: string; component: React.ComponentType; title?: string }> = [];

  switch (slot) {
    case "sidebar": {
      const target: Side = side ?? "left";
      // Resolve prefs once so the sort below sees a consistent snapshot.
      // Plugins without an explicit pref fall back to {side:'left', order:idx}
      // — preserving the registration order as the natural default.
      const decorated = plugins.sidebarPanels.map((p, idx) => {
        const pref = getPref(p.pluginId);
        // First-seen plugins anchor at their registration index so the
        // initial order matches the no-feature baseline. Once any pref
        // has been written, the stored order wins.
        const order = pref.order >= 0 ? pref.order : idx;
        return { p, side: pref.side, order, idx };
      });
      items = decorated
        .filter((d) => d.side === target)
        .sort((a, b) => a.order - b.order || a.idx - b.idx)
        .map((d) => ({
          id: d.p.id,
          pluginId: d.p.pluginId,
          component: d.p.component,
          title: d.p.title,
        }));
      break;
    }
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
    case "topbar-actions":
      items = plugins.topbarActions.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
  }

  if (items.length === 0) return null;

  if (slot === "sidebar") {
    const target: Side = side ?? "left";
    const orderedIds = items.map((it) => it.pluginId);
    return (
      <>
        {items.map((item, idx) => (
          <PluginErrorBoundary
            key={item.id}
            pluginId={item.pluginId}
            pluginName={item.title || item.pluginId}
          >
            <PluginSection
              pluginId={item.pluginId}
              side={target}
              index={idx}
              total={items.length}
              orderedIds={orderedIds}
            >
              <item.component />
            </PluginSection>
          </PluginErrorBoundary>
        ))}
      </>
    );
  }

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
