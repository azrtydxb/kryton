import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GraphView } from '@azrtydxb/ui';
import type { HoveredNodeInfo } from '@azrtydxb/ui';
import { GraphData } from '../../lib/api';
import { Icons } from '../Icons';
import { useMobileEmbed } from '../../hooks/useMobileEmbed';
import '../../styles/mobile-embed.css';

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
  title: string;
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
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
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
  const isMobile = useMobileEmbed();
  // Default to global so the rail always shows the whole graph at a glance.
  // Local is the focus mode the user opts into to see "what's connected to
  // this note"; global is the right idle state.
  const [internalMode, setInternalMode] = useState<'local' | 'global'>('global');
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
  const [zoom, setZoom] = useState(1);
  const recenterRef = useRef<(() => void) | null>(null);
  const expandedRecenterRef = useRef<(() => void) | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const expandedCanvasWrapRef = useRef<HTMLDivElement | null>(null);

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

  // Hover handler — bible card shows only title + path.
  const handleHover = useCallback((node: HoveredNodeInfo | null) => {
    if (!node) {
      setTooltip(null);
      return;
    }
    setTooltip({ title: node.title, path: node.path });
  }, []);

  // Dispatch a synthetic wheel event on the canvas wrapper to leverage
  // useViewport.web's existing wheel-zoom handler. GraphView's
  // onZoomChange callback is the single source of truth for the
  // indicator — it fires on this synthetic wheel, on real wheel
  // events, and on programmatic recentre, so the legend percentage
  // stays in sync with the actual transform without local shadowing.
  const dispatchZoom = useCallback((deltaY: number) => {
    const wrap = (expanded ? expandedCanvasWrapRef.current : canvasWrapRef.current);
    const target = wrap?.querySelector('canvas') ?? wrap;
    if (!target) return;
    const rect = (target as Element).getBoundingClientRect();
    const evt = new WheelEvent('wheel', {
      deltaY,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(evt);
  }, [expanded]);

  const handleRecenter = useCallback(() => {
    // Recenter changes viewport.k via fitToCanvas; GraphView's
    // onZoomChange surfaces the new scale through setZoom. We don't
    // force-set 1 here — the recenter may resolve to a non-1 scale
    // (small graphs zoom in, large graphs zoom out), and if the user
    // had only panned without changing zoom, viewport.k could even
    // stay constant — overwriting to 1 would lie about the actual
    // transform.
    if (expanded) expandedRecenterRef.current?.();
    else recenterRef.current?.();
  }, [expanded]);

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
  const renderCornerControls = () => (
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
        onClick={handleRecenter}
        aria-label="Recenter graph"
        title="Center"
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icons.Crosshair size={12} />
      </button>
      <button
        type="button"
        style={gfxBtn}
        onClick={() => dispatchZoom(-100)}
        aria-label="Zoom in"
        title="Zoom in"
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icons.Plus size={12} />
      </button>
      <button
        type="button"
        style={gfxBtn}
        onClick={() => dispatchZoom(100)}
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
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );

  // ---- Hover info card ----
  // Per prototype/app/graph.jsx (~line 116-123): corner-anchored at
  // bottom-left, bg-2, line border, 6px radius, mono 11/fg-1, title
  // 12/fg, subtitle fg-3 (inherits size from card root). No body
  // preview, no action button.
  const renderHoverCard = (t: TooltipState) => (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        padding: '8px 10px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--fg-1)',
        boxShadow: 'var(--shadow-md)',
        maxWidth: 280,
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: 'var(--fg)', fontSize: 12, marginBottom: 2 }}>{t.title}</div>
      <div style={{ color: 'var(--fg-3)' }}>{t.path}</div>
    </div>
  );

  // Render
  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    height: '100%',
    width: fullscreen ? '100%' : undefined,
    background: 'var(--bg-1)',
    borderLeft: fullscreen ? 'none' : '1px solid var(--line)',
    minWidth: 0,
    overflow: 'hidden',
  };

  return (
    <>
      <div style={containerStyle} className={isMobile ? "mobile-embed" : ""}>
        {renderHeader(fullscreen ? null : () => setExpanded(true))}
        {!expanded && (
          <div ref={canvasWrapRef} className={`bg-grid canvas-surface`} style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
            <GraphView
              graphData={graphData}
              loading={loading}
              activeNotePath={activeNotePath}
              mode={graphViewMode}
              onNoteSelect={fullscreen ? handleOverlayNoteSelect : onNoteSelect}
              onNodeHover={handleHover}
              recenterRef={recenterRef}
              starredPaths={starredPaths}
              showAllLabels={fullscreen}
              onZoomChange={setZoom}
            />
            {renderCornerControls()}
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
              </div>
              <div ref={expandedCanvasWrapRef} className="bg-grid canvas-surface" style={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}>
                <GraphView
                  graphData={graphData}
                  loading={loading}
                  activeNotePath={activeNotePath}
                  mode={graphViewMode}
                  onNoteSelect={handleOverlayNoteSelect}
                  onNodeHover={handleHover}
                  recenterRef={expandedRecenterRef}
                  starredPaths={starredPaths}
                  showAllLabels
                  onZoomChange={setZoom}
                />
                {renderCornerControls()}
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
