// packages/ui/src/graph/view/GraphView.web.tsx
import * as React from "react";
import { Loader2 } from "lucide-react";
import { createLayout } from "../layout";
import type { LayoutHandle, LayoutMode } from "../layout/types";
import { createCanvasPainter } from "./CanvasPainter.web";
import { drawScene } from "./drawScene";
import { createHitTest, type HitTest } from "./hitTest";
import { useViewport } from "../gestures/useViewport.web";
import { applyDragStart, applyDragMove, applyDragEnd } from "../gestures/useNodeDrag";
import type { GraphData, HoveredNodeInfo } from "../types";
import type { Scene } from "./Painter";
import { GRAPH_CONFIG } from "../graphConfig";

export interface GraphViewProps {
  graphData: GraphData | null;
  loading?: boolean;
  activeNotePath?: string | null;
  mode?: "full" | "local";
  onNoteSelect: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
  starredPaths?: Set<string>;
  className?: string;
  /** When true, render every node's label (fullscreen graph view). Defaults to false (rail mode shows labels only on active/hover). */
  showAllLabels?: boolean;
}

export function GraphView({
  graphData, loading = false, activeNotePath = null, mode = "full",
  onNoteSelect, onNodeHover, recenterRef, starredPaths, className,
  showAllLabels = false,
}: GraphViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const layoutRef = React.useRef<LayoutHandle | null>(null);
  const hitRef = React.useRef<HitTest | null>(null);
  const hoverRef = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ id: string; startX: number; startY: number } | null>(null);
  // Once the layout has been pre-settled we stop stepping the simulation —
  // continuing would let positions drift past the initial fit. Drag bumps
  // this back to false so the simulation runs while the user is dragging.
  const frozenRef = React.useRef(false);
  const { viewport, bind, setViewport } = useViewport();
  const layoutMode: LayoutMode = mode === "full" ? "global" : "local";

  /** Compute a viewport that frames the current layout positions inside (w, h). */
  const fitToCanvas = React.useCallback((w: number, h: number) => {
    const layout = layoutRef.current;
    if (!layout) return { x: w / 2, y: h / 2, k: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (const p of layout.positions()) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      count++;
    }
    if (count === 0 || !Number.isFinite(minX)) return { x: w / 2, y: h / 2, k: 1 };
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const margin = 60;
    // Auto-fit caps zoom-in at 1.5× so a sparse cluster doesn't blow up
    // node radii to the size of the rail. User can still pinch / wheel up
    // to scaleMax manually.
    const AUTO_FIT_MAX_K = 1.5;
    const k = Math.min(
      AUTO_FIT_MAX_K,
      Math.max(
        GRAPH_CONFIG.zoom.scaleMin,
        Math.min((w - margin) / bboxW, (h - margin) / bboxH),
      ),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
  }, []);

  // Build / rebuild layout when graphData, mode, or activeNotePath changes.
  // Settle for a few hundred ticks before fitting so the bbox is meaningful.
  React.useEffect(() => {
    if (!graphData) return;
    layoutRef.current?.dispose();
    const canvas = canvasRef.current!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
    layoutRef.current = createLayout({
      nodes: graphData.nodes, edges: graphData.edges, mode: layoutMode,
      activeId, width: w, height: h,
    });
    // Pre-settle so positions stabilise before the first paint, then freeze.
    frozenRef.current = false;
    for (let i = 0; i < 500; i++) layoutRef.current.step();
    frozenRef.current = true;
    hitRef.current = createHitTest(
      [...layoutRef.current.positions()],
      Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
    );
    setViewport(fitToCanvas(w, h));
    return () => {
      layoutRef.current?.dispose();
      layoutRef.current = null;
    };
  }, [graphData, layoutMode, activeNotePath, setViewport, fitToCanvas]);

  // Recenter handle — fits the bounding box of current positions to the canvas.
  React.useEffect(() => {
    if (!recenterRef) return;
    recenterRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setViewport(fitToCanvas(canvas.clientWidth, canvas.clientHeight));
    };
  }, [recenterRef, setViewport, fitToCanvas]);

  // Render loop.
  React.useEffect(() => {
    let raf = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      const layout = layoutRef.current;
      const hit = hitRef.current;
      if (canvas && layout && graphData) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.clientWidth, h = canvas.clientHeight;
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          if (!frozenRef.current || dragRef.current) {
            layout.step();
            hit?.rebuild([...layout.positions()]);
          }

          const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
          const localSet = computeLocalSet(graphData, activeId, layoutMode);
          const scene: Scene = {
            transform: viewport,
            theme: detectTheme(),
            mode: layoutMode,
            showAllLabels,
            tokens: resolveTokens(canvas),
            nodes: graphData.nodes.map((n) => {
              const pos = layout.getPosition(n.id);
              return {
                node: n,
                position: pos ?? { id: n.id, x: 0, y: 0 },
                isActive: n.id === activeId,
                isHovered: n.id === hoverRef.current,
                isStarred: !!(starredPaths && starredPaths.has(n.path)),
                isShared: !!n.shared,
                isVisible: !!pos,
                isInLocalSet: localSet ? localSet.has(n.id) : true,
              };
            }),
            edges: graphData.edges
              .map((e) => {
                const fp = layout.getPosition(e.fromNoteId);
                const tp = layout.getPosition(e.toNoteId);
                if (!fp || !tp) return null;
                return {
                  fromPosition: fp,
                  toPosition: tp,
                  isActive: e.fromNoteId === activeId || e.toNoteId === activeId,
                  isHovered: e.fromNoteId === hoverRef.current || e.toNoteId === hoverRef.current,
                  isInLocalSet: localSet
                    ? localSet.has(e.fromNoteId) && localSet.has(e.toNoteId)
                    : true,
                };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null),
          };

          drawScene(createCanvasPainter(ctx), scene, w, h);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graphData, viewport, activeNotePath, layoutMode, starredPaths]);

  // Hover + click + drag from pointer events on the wrapper.
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wx = (sx - viewport.x) / viewport.k;
    const wy = (sy - viewport.y) / viewport.k;
    if (dragRef.current) {
      applyDragMove(layoutRef.current!, dragRef.current.id, wx, wy);
      return;
    }
    const id = hitRef.current?.test(wx, wy) ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      if (onNodeHover) {
        const n = id ? graphData?.nodes.find((x) => x.id === id) : null;
        onNodeHover(n ? { path: n.path, title: n.title, x: sx, y: sy } : null);
      }
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wx = (e.clientX - rect.left - viewport.x) / viewport.k;
    const wy = (e.clientY - rect.top - viewport.y) / viewport.k;
    const id = hitRef.current?.test(wx, wy);
    if (id) {
      dragRef.current = { id, startX: e.clientX, startY: e.clientY };
      // Unfreeze so the dragged node can move and the rest react.
      frozenRef.current = false;
      applyDragStart(layoutRef.current!, id, wx, wy);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      applyDragEnd(layoutRef.current!, dragRef.current.id);
      // Only treat as click if the pointer didn't move much.
      if (dist <= 5) {
        const node = graphData?.nodes.find((n) => n.id === dragRef.current!.id);
        if (node) onNoteSelect(node.path);
      }
      dragRef.current = null;
      // Re-freeze after the user lets go so the simulation stops.
      frozenRef.current = true;
    }
  };

  return (
    <div
      className={className ?? "relative flex flex-1 overflow-hidden"}
      ref={(el) => bind(el)}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      aria-label="Knowledge graph"
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-violet-500" aria-label="Loading graph…" />
        </div>
      )}
      {graphData && graphData.nodes.length === 0 && !loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
          No notes yet
        </div>
      )}
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function detectTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Resolve the graph palette from live CSS variables on the canvas's nearest
 * styled ancestor. Canvas itself doesn't inherit custom-property reads
 * reliably across all browsers, so we read from documentElement which always
 * carries the global token sheet. Fallback `undefined` lets drawScene fall
 * back to the static GRAPH_CONFIG palette when tokens are missing (tests,
 * SSR, native).
 */
function resolveTokens(canvas: HTMLCanvasElement): Scene["tokens"] | undefined {
  if (typeof document === "undefined" || !canvas) return undefined;
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  const bg2 = get("--bg-2");
  if (!bg2) return undefined;
  return {
    bg2,
    fg3: get("--fg-3"),
    fg4: get("--fg-4"),
    accent: get("--accent"),
    accent2: get("--accent-2"),
    accentSoft: get("--accent-soft"),
  };
}

function computeLocalSet(
  data: GraphData, activeId: string | null, mode: LayoutMode,
): Set<string> | null {
  if (mode !== "local" || !activeId) return null;
  const set = new Set<string>([activeId]);
  const adj = new Map<string, Set<string>>();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const e of data.edges) {
    adj.get(e.fromNoteId)?.add(e.toNoteId);
    adj.get(e.toNoteId)?.add(e.fromNoteId);
  }
  for (const id of adj.get(activeId) ?? []) {
    set.add(id);
    for (const id2 of adj.get(id) ?? []) set.add(id2);
  }
  return set;
}
