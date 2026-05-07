import { GraphPanel } from '../Graph/GraphPanel';
import { GraphData } from '../../lib/api';
import { usePrefs } from '../../stores/prefsStore';

/**
 * RightPanel — graph rail per design handoff (prototype/app/graph.jsx).
 *
 * Width is 340px (var(--bg-1)/border-left line). The Outline pane was
 * intentionally removed to match the prototype, which renders only the
 * graph in the right rail.
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
      <GraphPanel
        graphData={graphData}
        loading={graphLoading}
        activeNotePath={activeNotePath}
        onNoteSelect={onNoteSelect}
        starredPaths={starredPaths}
      />
    </aside>
  );
}
