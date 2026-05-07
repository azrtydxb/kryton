import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GraphView } from '@azrtydxb/ui';
import type { HoveredNodeInfo } from '@azrtydxb/ui';
import { GraphData, api } from '../../lib/api';
import { Icons } from '../Icons';

interface GraphPanelProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
  /**
   * `local` — 2-hop neighbourhood centred on `activeNotePath`.
   * `global` — global force-layout (alias of GraphView's `full`).
   * Controlled mode; if omitted the panel manages its own state.
   */
  mode?: 'local' | 'global';
  onModeChange?: (m: 'local' | 'global') => void;
  /** When true, render in fullscreen layout (no rounded corners, no rail border). */
  fullscreen?: boolean;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  preview: string;
  path: string;
}

const railHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  padding: '0 12px',
  borderBottom: '1px solid var(--line)',
  flexShrink: 0,
  background: 'var(--bg-1)',
};

const segmentedWrap: CSSProperties = {
  display: 'flex',
  gap: 1,
  padding: 2,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 6,
};

function segmentBtn(active: boolean): CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: active ? 'var(--accent)' : 'var(--fg-2)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
  };
}

/** Corner-control button per prototype/app/graph.jsx GfxBtn (26×26, bg-2, line border). */
const gfxBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 5,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  color: 'var(--fg-2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'color 120ms, border-color 120ms',
};

const legendStrip: CSSProperties = {
  height: 28,
  padding: '0 12px',
  borderTop: '1px solid var(--line)',
  background: 'var(--bg-1)',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--fg-3)',
  flexShrink: 0,
};

export function GraphPanel({
  graphData,
  loading,
  activeNotePath,
  onNoteSelect,
  starredPaths,
  mode: controlledMode,
  onModeChange,
  fullscreen = false,
}: GraphPanelProps) {
  const [internalMode, setInternalMode] = useState<'local' | 'global'>('local');
  const mode = controlledMode ?? internalMode;
  const setMode = useCallback(
    (m: 'local' | 'global') => {
      if (onModeChange) onModeChange(m);
      else setInternalMode(m);
    },
    [onModeChange],
  );

  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const recenterRef = useRef<(() => void) | null>(null);
  const expandedRecenterRef = useRef<(() => void) | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCacheRef = useRef<Map<string, string>>(new Map());

  // If no active note, force global mode (local is meaningless)
  const effectiveMode: 'local' | 'global' = activeNotePath ? mode : 'global';
  // GraphView consumes "full" instead of "global"
  const graphViewMode: 'local' | 'full' = effectiveMode === 'global' ? 'full' : 'local';

  // Close overlay on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        setTooltip(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded]);

  const handleOverlayNoteSelect = useCallback(
    (path: string) => {
      onNoteSelect(path);
      setExpanded(false);
      setTooltip(null);
    },
    [onNoteSelect],
  );

  // Hover handler — fetches preview for the info card.
  const handleHover = useCallback((node: HoveredNodeInfo | null) => {
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
      setTooltip({ x: node.x, y: node.y, title: node.title, preview: cached, path: node.path });
      return;
    }
    hoverTimerRef.current = setTimeout(async () => {
      try {
        const note = await api.getNote(node.path);
        const body = note.content.replace(/^---[\s\S]*?---\n*/, '');
        const lines = body.split('\n').filter((l) => l.trim()).slice(0, 3);
        const preview = lines.join('\n').slice(0, 200);
        previewCacheRef.current.set(node.path, preview);
        setTooltip({ x: node.x, y: node.y, title: node.title, preview, path: node.path });
      } catch {
        previewCacheRef.current.set(node.path, '');
        setTooltip({ x: node.x, y: node.y, title: node.title, preview: '', path: node.path });
      }
    }, 200);
  }, []);

  const nodeCount = graphData?.nodes.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;

  // ---- Header ----
  const renderHeader = (_onExpand: (() => void) | null) => (
    <div style={railHeader}>
      <Icons.Network size={13} style={{ color: 'var(--accent)' }} />
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--fg-3)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        graph
      </span>
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}
      >
        {nodeCount}n {edgeCount}e
      </span>
      <div style={{ flex: 1 }} />
      <div style={segmentedWrap}>
        <button
          type="button"
          onClick={() => setMode('local')}
          style={segmentBtn(effectiveMode === 'local')}
          disabled={!activeNotePath}
          aria-pressed={effectiveMode === 'local'}
        >
          local
        </button>
        <button
          type="button"
          onClick={() => setMode('global')}
          style={segmentBtn(effectiveMode === 'global')}
          aria-pressed={effectiveMode === 'global'}
        >
          global
        </button>
      </div>
    </div>
  );

  // Canvas overlay corner controls — per prototype/app/graph.jsx,
  // a vertical stack at top-right of the canvas: Center, Zoom in, Zoom out.
  const renderCornerControls = (onExpand: (() => void) | null) => (
    <div
      style={{
        position: 'absolute',
        top: 10, right: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        zIndex: 5,
      }}
    >
      <button
        type="button"
        style={gfxBtn}
        onClick={() => (fullscreen ? expandedRecenterRef.current?.() : recenterRef.current?.())}
        aria-label="Recenter graph"
        title="Center"
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icons.Crosshair size={12} />
      </button>
      {onExpand && (
        <button
          type="button"
          style={gfxBtn}
          onClick={onExpand}
          aria-label="Expand graph"
          title="Expand"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
        >
          <Icons.Plus size={12} />
        </button>
      )}
      <button
        type="button"
        style={gfxBtn}
        aria-label="Zoom out"
        title="Zoom out"
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icons.Minus size={12} />
      </button>
    </div>
  );

  // ---- Legend ----
  // Per prototype/app/graph.jsx: active (accent dot) · note (bg-2 dot
  // with fg-3 ring) · link (14×1 accent bar) · spacer · zoom %.
  const renderLegend = () => (
    <div style={legendStrip}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
        active
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--bg-2)', border: '1px solid var(--fg-3)',
          }}
        />
        note
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 14, height: 1, background: 'var(--accent)' }} />
        link
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ color: 'var(--fg-4)' }}>100%</span>
    </div>
  );

  // ---- Hover info card ----
  const renderHoverCard = (t: TooltipState) => (
    <div
      style={{
        position: 'absolute',
        left: Math.min(t.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 320),
        top: Math.max(t.y - 70, 8),
        maxWidth: 300,
        background: 'var(--bg-1)',
        border: '1px solid var(--line-strong)',
        borderRadius: 8,
        padding: 10,
        boxShadow: 'var(--shadow-md)',
        zIndex: 10,
        pointerEvents: 'auto',
        animation: 'kryton-fade-in 200ms ease-out',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: 'var(--fg)',
          fontWeight: 500,
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {t.title}
      </div>
      <div
        className="mono"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--fg-3)',
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {t.path}
      </div>
      {t.preview && (
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--fg-2)',
            lineHeight: 1.5,
            marginBottom: 8,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {t.preview}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (fullscreen) handleOverlayNoteSelect(t.path);
          else onNoteSelect(t.path);
        }}
        className="mono"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationStyle: 'dashed',
          textUnderlineOffset: 3,
        }}
      >
        open
      </button>
    </div>
  );

  // Render
  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-1)',
    minWidth: 0,
    overflow: 'hidden',
  };

  return (
    <>
      <div style={containerStyle}>
        {renderHeader(fullscreen ? null : () => setExpanded(true))}
        {!expanded && (
          <div className="bg-grid" style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
            <GraphView
              graphData={graphData}
              loading={loading}
              activeNotePath={activeNotePath}
              mode={graphViewMode}
              onNoteSelect={fullscreen ? handleOverlayNoteSelect : onNoteSelect}
              onNodeHover={handleHover}
              recenterRef={recenterRef}
              starredPaths={starredPaths}
            />
            {renderCornerControls(fullscreen ? null : () => setExpanded(true))}
            {tooltip && renderHoverCard(tooltip)}
          </div>
        )}
        {renderLegend()}
      </div>

      {/* Fullscreen portal overlay (only when used as side rail) */}
      {expanded &&
        !fullscreen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100000,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setExpanded(false);
                setTooltip(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Graph fullscreen"
              style={{
                width: '100%',
                height: '100%',
                maxWidth: 1400,
                maxHeight: 900,
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--bg-1)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
              }}
            >
              <div style={railHeader}>
                <Icons.Network size={14} style={{ color: 'var(--fg-3)' }} />
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-2)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.04em',
                  }}
                >
                  graph
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}
                >
                  {nodeCount}n {edgeCount}e
                </span>
                <div style={{ flex: 1 }} />
                <div style={segmentedWrap}>
                  <button
                    type="button"
                    onClick={() => setMode('local')}
                    style={segmentBtn(effectiveMode === 'local')}
                    disabled={!activeNotePath}
                  >
                    local
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('global')}
                    style={segmentBtn(effectiveMode === 'global')}
                  >
                    global
                  </button>
                </div>
                <button
                  type="button"
                  style={gfxBtn}
                  onClick={() => {
                    setExpanded(false);
                    setTooltip(null);
                  }}
                  aria-label="Close fullscreen"
                  title="Close"
                >
                  <Icons.X size={12} />
                </button>
              </div>
              <div className="bg-grid" style={{ flex: 1, position: 'relative', backgroundColor: 'var(--bg)' }}>
                <GraphView
                  graphData={graphData}
                  loading={loading}
                  activeNotePath={activeNotePath}
                  mode={graphViewMode}
                  onNoteSelect={handleOverlayNoteSelect}
                  onNodeHover={handleHover}
                  recenterRef={expandedRecenterRef}
                  starredPaths={starredPaths}
                />
                {renderCornerControls(null)}
                {tooltip && renderHoverCard(tooltip)}
              </div>
              {renderLegend()}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
