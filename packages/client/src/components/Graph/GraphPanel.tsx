import { useState, useRef, useCallback, useEffect } from 'react';
import { Network, Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
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
  const [expanded, setExpanded] = useState(false);
  const recenterRef = useRef<(() => void) | null>(null);
  const expandedRecenterRef = useRef<(() => void) | null>(null);

  const effectiveMode = activeNotePath ? mode : 'full';

  // Close overlay on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded]);

  // When clicking a node in overlay, navigate and close
  const handleOverlayNoteSelect = useCallback((path: string) => {
    onNoteSelect(path);
    setExpanded(false);
  }, [onNoteSelect]);

  return (
    <>
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
            <button
              onClick={() => setExpanded(true)}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded transition-colors"
              aria-label="Expand graph"
              title="Expand graph"
            >
              <Maximize2 size={13} />
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

      {/* Full-screen overlay */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 bg-black/80 flex flex-col"
          style={{ zIndex: 99998 }}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-surface-900 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <Network size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-gray-200">Knowledge Graph</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => expandedRecenterRef.current?.()}
                className="p-1.5 text-gray-400 hover:text-gray-200 rounded transition-colors"
                aria-label="Center graph"
                title="Center graph"
              >
                <Crosshair size={16} />
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 text-gray-400 hover:text-gray-200 rounded transition-colors"
                aria-label="Close overlay"
                title="Close overlay"
              >
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1">
            <GraphView
              graphData={graphData}
              loading={loading}
              activeNotePath={activeNotePath}
              mode="full"
              onNoteSelect={handleOverlayNoteSelect}
              recenterRef={expandedRecenterRef}
              starredPaths={starredPaths}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
