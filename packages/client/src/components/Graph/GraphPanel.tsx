import { useState, useRef, useCallback, useEffect } from 'react';
import { Network, Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { GraphView } from './GraphView';
import { GraphData, api } from '../../lib/api';
import type { HoveredNodeInfo } from './useD3Graph';

interface GraphPanelProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  preview: string;
}

export function GraphPanel({ graphData, loading, activeNotePath, onNoteSelect, starredPaths }: GraphPanelProps) {
  const [mode, setMode] = useState<'local' | 'full'>('local');
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const recenterRef = useRef<(() => void) | null>(null);
  const expandedRecenterRef = useRef<(() => void) | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCacheRef = useRef<Map<string, string>>(new Map());

  const effectiveMode = activeNotePath ? mode : 'full';

  // Close overlay on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setExpanded(false); setTooltip(null); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded]);

  // When clicking a node in overlay, navigate and close
  const handleOverlayNoteSelect = useCallback((path: string) => {
    onNoteSelect(path);
    setExpanded(false);
    setTooltip(null);
  }, [onNoteSelect]);

  // Handle hover in overlay — fetch preview after short delay
  const handleOverlayHover = useCallback((node: HoveredNodeInfo | null) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (!node) {
      setTooltip(null);
      return;
    }

    const cached = previewCacheRef.current.get(node.path);
    if (cached !== undefined) {
      setTooltip({ x: node.x, y: node.y, title: node.title, preview: cached });
      return;
    }

    // Delay fetch to avoid hammering API on quick mouse passes
    hoverTimerRef.current = setTimeout(async () => {
      try {
        const note = await api.getNote(node.path);
        // Strip frontmatter and take first 3 non-empty lines
        const body = note.content.replace(/^---[\s\S]*?---\n*/, '');
        const lines = body.split('\n').filter(l => l.trim()).slice(0, 3);
        const preview = lines.join('\n').slice(0, 200);
        previewCacheRef.current.set(node.path, preview);
        setTooltip({ x: node.x, y: node.y, title: node.title, preview });
      } catch {
        previewCacheRef.current.set(node.path, '');
        setTooltip(null);
      }
    }, 300);
  }, []);

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
        {!expanded && (
          <GraphView
            graphData={graphData}
            loading={loading}
            activeNotePath={activeNotePath}
            mode={effectiveMode}
            onNoteSelect={onNoteSelect}
            recenterRef={recenterRef}
            starredPaths={starredPaths}
          />
        )}
      </div>

      {/* Full-screen overlay */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center p-6 backdrop-blur-sm"
          style={{ zIndex: 100000, backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setExpanded(false); setTooltip(null); } }}
        >
          <div
            className="w-full h-full max-w-[1400px] max-h-[900px] flex flex-col rounded-xl border border-gray-700/50 bg-surface-950 shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="graph-overlay-title"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-surface-900 rounded-t-xl">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-violet-400" />
                <span id="graph-overlay-title" className="text-sm font-semibold text-gray-200">Knowledge Graph</span>
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
            <div className="flex-1 bg-surface-950 relative">
              <GraphView
                graphData={graphData}
                loading={loading}
                activeNotePath={activeNotePath}
                mode="full"
                onNoteSelect={handleOverlayNoteSelect}
                onNodeHover={handleOverlayHover}
                recenterRef={expandedRecenterRef}
                starredPaths={starredPaths}
              />
              {/* Hover tooltip */}
              {tooltip && (
                <div
                  className="absolute pointer-events-none max-w-[320px] bg-surface-900 border border-gray-700/50 rounded-lg shadow-xl px-4 py-3"
                  style={{
                    left: Math.min(tooltip.x + 16, window.innerWidth - 350),
                    top: Math.max(tooltip.y - 80, 10),
                    zIndex: 100001,
                  }}
                >
                  <div className="text-sm font-semibold text-violet-400 mb-1 truncate">{tooltip.title}</div>
                  {tooltip.preview ? (
                    <div className="text-xs text-gray-400 whitespace-pre-line leading-relaxed line-clamp-3">
                      {tooltip.preview}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 italic">No content</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
