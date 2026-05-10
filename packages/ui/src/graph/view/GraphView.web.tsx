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
  // d3-force style alpha decay: simulation runs while alpha > alphaMin, then
  // stops. Selecting a note or dragging reheats it back to 1. Without this
  // the cluster vibrates indefinitely — repulsion never wins enough to be
  // counted "still" and the spring keeps wobbling. With decay the graph
  // settles to a quiet equilibrium, then perturbs and re-settles on input.
  const alphaRef = React.useRef(1);
  const ALPHA_MIN = 0.005;
  const ALPHA_DECAY = 0.018;
  const { viewport, bind, setViewport } = useViewport();
  const layoutMode: LayoutMode = mode === "full" ? "global" : "local";

  /**
   * Compute a viewport that frames the current layout's bounding box inside
   * (w, h). Used at mount and when the user hits the recenter button. With
   * an active note the render loop continuously pans the camera to follow
   * the active's world position, so initial fit just sets the zoom — the
   * follow logic handles centring afterwards.
   */
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

  // Latest activeNotePath, read by long-lived effects that only want to
  // react to graphData / mode changes (not selection). Selection is handled
  // by a separate effect that calls layout.setActive.
  const activePathRef = React.useRef(activeNotePath);
  activePathRef.current = activeNotePath;

  // Build the layout once per graphData / mode. Selection is handled below.
  React.useEffect(() => {
    if (!graphData) return;
    layoutRef.current?.dispose();
    const canvas = canvasRef.current!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const activeId = graphData.nodes.find((n) => n.path === activePathRef.current)?.id ?? null;
    layoutRef.current = createLayout({
      nodes: graphData.nodes, edges: graphData.edges, mode: layoutMode,
      activeId, width: w, height: h,
    });
    for (let i = 0; i < 200; i++) layoutRef.current.step();
    alphaRef.current = 1;
    hitRef.current = createHitTest(
      [...layoutRef.current.positions()],
      Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
    );
    setViewport(fitToCanvas(w, h));
    return () => {
      layoutRef.current?.dispose();
      layoutRef.current = null;
    };
  }, [graphData, layoutMode, setViewport, fitToCanvas]);

  // Selection: morph in global mode (swap the pin, preserve positions),
  // rebuild in local mode (concentric rings are keyed on active id).
  React.useEffect(() => {
    if (!graphData) return;
    const layout = layoutRef.current;
    if (!layout) return;
    const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
    if (layoutMode === "local") {
      // Full rebuild — the layout structure depends on the active id.
      layout.dispose();
      const canvas = canvasRef.current!;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      layoutRef.current = createLayout({
        nodes: graphData.nodes, edges: graphData.edges, mode: layoutMode,
        activeId, width: w, height: h,
      });
      for (let i = 0; i < 200; i++) layoutRef.current.step();
      hitRef.current = createHitTest(
        [...layoutRef.current.positions()],
        Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
      );
      setViewport(fitToCanvas(w, h));
    } else {
      layout.setActive(activeId);
    }
    alphaRef.current = 1;
  }, [activeNotePath, graphData, layoutMode, setViewport, fitToCanvas]);

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
          // Step only while the simulation has energy. Drag forces a step
          // regardless so the dragged node tracks the pointer instantly.
          if (alphaRef.current > ALPHA_MIN || dragRef.current) {
            layout.step();
            hit?.rebuild([...layout.positions()]);
            alphaRef.current = Math.max(
              ALPHA_MIN,
              alphaRef.current * (1 - ALPHA_DECAY),
            );
          }

          const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;

          // Camera follow: when an active note exists, glide the viewport so
          // the active node sits at the canvas centre. We lerp toward the
          // target each frame (15% per frame ≈ ~250ms half-life) so selecting
          // a different note pans smoothly instead of snapping.
          if (activeId) {
            const pos = layout.getPosition(activeId);
            if (pos) {
              const targetX = w / 2 - pos.x * viewport.k;
              const targetY = h / 2 - pos.y * viewport.k;
              const dx = targetX - viewport.x;
              const dy = targetY - viewport.y;
              if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                setViewport({
                  x: viewport.x + dx * 0.15,
                  y: viewport.y + dy * 0.15,
                  k: viewport.k,
                });
              }
            }
          }
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
      // Reheat so the rest of the cluster reacts to the drag instead of
      // the dragged node moving through frozen positions.
      alphaRef.current = 1;
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
    fg1: get("--fg-1"),
    fg3: get("--fg-3"),
    fg4: get("--fg-4"),
    line: get("--line"),
    accent: get("--accent"),
    accent2: get("--accent-2"),
    accentSoft: get("--accent-soft"),
  };
}

// Per prototype/app/graph.jsx ~line 14-16:
//   const visibleNodes = mode === 'local' && activeId
//     ? nodes.filter(n => n.id === activeId
//         || edges.some(([a,b]) => (a === activeId && b === n.id) || (b === activeId && a === n.id)))
//     : nodes;
// Local mode shows ONLY the active note + direct (1-hop) neighbours. Local
// without an active note matches global. Global always shows everything.
function computeLocalSet(
  data: GraphData, activeId: string | null, mode: LayoutMode,
): Set<string> | null {
  if (mode !== "local" || !activeId) return null;
  const set = new Set<string>([activeId]);
  for (const e of data.edges) {
    if (e.fromNoteId === activeId) set.add(e.toNoteId);
    else if (e.toNoteId === activeId) set.add(e.fromNoteId);
  }
  return set;
}
