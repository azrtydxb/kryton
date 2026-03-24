import { GraphPanel } from '../Graph/GraphPanel';
import { OutlinePane } from '../Outline/OutlinePane';
import { ResizeHandle } from './ResizeHandle';
import { GraphData } from '../../lib/api';

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
  rightPanelWidth, graphHeight,
  graphData, graphLoading,
  activeNotePath, activeNoteContent, starredPaths,
  onRightPanelResize, onGraphResize,
  onNoteSelect, onOutlineJump,
}: RightPanelProps) {
  return (
    <>
      <ResizeHandle direction="horizontal" onResize={onRightPanelResize} />
      <aside
        className="flex-shrink-0 flex flex-col bg-gray-50 dark:bg-surface-900 overflow-hidden"
        style={{ width: `${rightPanelWidth}px` }}
      >
        <div style={graphHeight != null ? { height: `${graphHeight}px` } : { flex: 1 }} className="flex flex-col overflow-hidden">
          <GraphPanel
            graphData={graphData}
            loading={graphLoading}
            activeNotePath={activeNotePath}
            onNoteSelect={onNoteSelect}
            starredPaths={starredPaths}
          />
        </div>
        {activeNoteContent != null && (
          <>
            <ResizeHandle direction="vertical" onResize={onGraphResize} />
            <div className="flex-1 min-h-[100px] overflow-hidden">
              <OutlinePane content={activeNoteContent} onJumpToLine={onOutlineJump} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}
