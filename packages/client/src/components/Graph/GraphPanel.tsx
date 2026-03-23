import { useState, useRef } from 'react';
import { Network, Crosshair } from 'lucide-react';
import { GraphView } from './GraphView';
import { GraphData } from '../../lib/api';

interface GraphPanelProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
}

export function GraphPanel({ graphData, loading, activeNotePath, onNoteSelect, starredPaths }: GraphPanelProps) {
  const [mode, setMode] = useState<'local' | 'full'>('local');
  const recenterRef = useRef<(() => void) | null>(null);

  // Force full mode when no note is selected (local mode needs an anchor)
  const effectiveMode = activeNotePath ? mode : 'full';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Graph</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => recenterRef.current?.()}
            className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded transition-colors"
            aria-label="Center graph"
            title="Center graph"
          >
            <Crosshair size={13} />
          </button>
          <button
            onClick={() => setMode('local')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              effectiveMode === 'local'
                ? 'bg-violet-500/15 text-violet-500 font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Local
          </button>
          <button
            onClick={() => setMode('full')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              effectiveMode === 'full'
                ? 'bg-violet-500/15 text-violet-500 font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Full
          </button>
        </div>
      </div>
      <GraphView
        graphData={graphData}
        loading={loading}
        activeNotePath={activeNotePath}
        mode={effectiveMode}
        onNoteSelect={onNoteSelect}
        recenterRef={recenterRef}
        starredPaths={starredPaths}
      />
    </div>
  );
}
