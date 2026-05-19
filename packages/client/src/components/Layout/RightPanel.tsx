import { GraphPanel } from '../Graph/GraphPanel';
import { GraphData } from '../../lib/api';
import { usePrefs } from '../../stores/prefsStore';
import { PluginSlot } from '../PluginSlot/PluginSlot';
import { usePluginSlots } from '@azrtydxb/ui';
import { useSidebarSides, getSide } from '../../plugins/sidebarPrefs';

/**
 * RightPanel — graph rail per design handoff (prototype/app/graph.jsx).
 *
 * Width is 340px (var(--bg-1)/border-left line). The Outline pane was
 * intentionally removed to match the prototype, which renders only the
 * graph in the right rail.
 *
 * Plugin panels the user has moved to the right side stack underneath
 * the graph in a scrollable region; the graph itself stays at the top
 * with a min-height so it can't be squeezed to nothing. When no plugins
 * are right-assigned the layout collapses back to the original "graph
 * fills the rail" view bit-for-bit.
 */
interface RightPanelProps {
  /** kept for parent API compatibility — width is now a fixed 340px per design. */
  rightPanelWidth?: number;
  graphData: GraphData | null;
  graphLoading: boolean;
  activeNotePath: string | null;
  starredPaths: Set<string>;
  /** kept for parent API compatibility; the resize handle was removed. */
  onRightPanelResize?: (delta: number) => void;
  onNoteSelect: (path: string) => void;
}

export function RightPanel({
  graphData,
  graphLoading,
  activeNotePath,
  starredPaths,
  onNoteSelect,
}: RightPanelProps) {
  const graphPosition = usePrefs((s) => s.graphPosition);
  // Subscribe to side-pref changes so toggling a plugin between rails
  // re-renders this panel (showing/hiding the plugin stack).
  useSidebarSides();
  const { sidebarPanels } = usePluginSlots();
  const hasRightPlugins = sidebarPanels.some(
    (p) => getSide(p.pluginId) === 'right',
  );

  if (graphPosition === 'hidden') return null;

  return (
    <aside
      className="hidden md:flex flex-shrink-0 flex-col overflow-hidden"
      style={{
        width: 340,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          flex: hasRightPlugins ? '1 1 0' : '1 1 auto',
          minHeight: 280,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <GraphPanel
          graphData={graphData}
          loading={graphLoading}
          activeNotePath={activeNotePath}
          onNoteSelect={onNoteSelect}
          starredPaths={starredPaths}
        />
      </div>
      {hasRightPlugins && (
        <div
          data-kryton-sidebar-scroll
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            scrollbarGutter: 'stable',
          }}
        >
          <PluginSlot slot="sidebar" side="right" />
        </div>
      )}
    </aside>
  );
}
