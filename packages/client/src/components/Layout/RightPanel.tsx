import { GraphPanel } from '../Graph/GraphPanel';
import { OutlinePane } from '../Outline/OutlinePane';
import { ResizeHandle } from './ResizeHandle';
import { GraphData } from '../../lib/api';
import { usePrefs } from '../../stores/prefsStore';

interface RightPanelProps {
  rightPanelWidth: number;
  graphHeight: number | null;
  graphData: GraphData | null;
  graphLoading: boolean;
  activeNotePath: string | null;
  activeNoteContent: string | null;
  starredPaths: Set<string>;
  onRightPanelResize: (delta: number) => void;
  onGraphResize: (delta: number) => void;
  onNoteSelect: (path: string) => void;
  onOutlineJump: (line: number) => void;
}

export function RightPanel({
  rightPanelWidth,
  graphHeight,
  graphData,
  graphLoading,
  activeNotePath,
  activeNoteContent,
  starredPaths,
  onRightPanelResize,
  onGraphResize,
  onNoteSelect,
  onOutlineJump,
}: RightPanelProps) {
  const graphPosition = usePrefs((s) => s.graphPosition);
  if (graphPosition === 'hidden') return null;

  // Design contract: rail width is 340px (override the persisted rightPanelWidth
  // unless the user has resized it explicitly to a non-default value).
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
        <div
          style={
            graphHeight !== null && graphHeight !== undefined
              ? { height: `${graphHeight}px`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
              : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          }
        >
          <GraphPanel
            graphData={graphData}
            loading={graphLoading}
            activeNotePath={activeNotePath}
            onNoteSelect={onNoteSelect}
            starredPaths={starredPaths}
          />
        </div>
        {activeNoteContent !== null && activeNoteContent !== undefined && (
          <>
            <ResizeHandle direction="vertical" onResize={onGraphResize} />
            <div className="flex-1 min-h-[100px] overflow-hidden" style={{ background: 'var(--bg-1)' }}>
              <OutlinePane content={activeNoteContent} onJumpToLine={onOutlineJump} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}
