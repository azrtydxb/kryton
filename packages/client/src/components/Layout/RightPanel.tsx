import { GraphPanel } from '../Graph/GraphPanel';
import { ResizeHandle } from './ResizeHandle';
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
  rightPanelWidth: number;
  graphData: GraphData | null;
  graphLoading: boolean;
  activeNotePath: string | null;
  starredPaths: Set<string>;
  onRightPanelResize: (delta: number) => void;
  onNoteSelect: (path: string) => void;
}

export function RightPanel({
  rightPanelWidth,
  graphData,
  graphLoading,
  activeNotePath,
  starredPaths,
  onRightPanelResize,
  onNoteSelect,
}: RightPanelProps) {
  const graphPosition = usePrefs((s) => s.graphPosition);
  if (graphPosition === 'hidden') return null;

  const width = rightPanelWidth || 340;

  return (
    <>
      <div className="hidden md:flex self-stretch">
        <ResizeHandle direction="horizontal" onResize={onRightPanelResize} />
      </div>
      <aside
        className="hidden md:flex flex-shrink-0 flex-col overflow-hidden"
        style={{
          width: `${width}px`,
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
    </>
  );
}
