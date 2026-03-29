import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { GraphData } from '../../lib/api';
import { useD3Graph } from './useD3Graph';
import type { HoveredNodeInfo } from './useD3Graph';

interface GraphViewProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  mode: 'local' | 'full';
  onNoteSelect: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
  starredPaths?: Set<string>;
}

export function GraphView({ graphData, loading, activeNotePath, mode, onNoteSelect, onNodeHover, recenterRef, starredPaths }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useD3Graph(canvasRef, graphData, {
    activeNotePath,
    mode,
    starredPaths,
    onNodeClick: onNoteSelect,
    onNodeHover,
    recenterRef,
  });

  return (
    <div className="flex-1 relative overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-violet-500" />
        </div>
      )}
      {graphData && graphData.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
          No notes yet
        </div>
      )}
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
