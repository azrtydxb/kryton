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
  /**
   * Notified whenever the viewport scale changes — wheel zoom, pinch,
   * programmatic recenter, etc. Lets parents that render a zoom-level
   * indicator stay in sync with the actual transform instead of
   * shadowing it.
   */
  onZoomChange?: (scale: number) => void;
}

export function GraphView({
  graphData, loading = false, activeNotePath = null, mode = "full",
  onNoteSelect, onNodeHover, recenterRef, starredPaths, className,
  showAllLabels = false, onZoomChange,
}: GraphViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const layoutRef = React.useRef<LayoutHandle | null>(null);
  const hitRef = React.useRef<HitTest | null>(null);
  const hoverRef = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ id: string; startX: number; startY: number } | null>(null);
  // Tracks which active note we last centred the camera on. The render-loop
  // camera-follow only fires when this drifts behind activeNotePath — so a
  // selection re-centres once, but subsequent user pan/wheel isn't fought
  // by the follower every frame.
  const centredOnRef = React.useRef<string | null>(null);
  const { viewport, bind, setViewport } = useViewport();
  // viewportRef mirrors the React state; the render loop and camera-follow
  // read/write through the ref so the effect doesn't need `viewport` in its
  // deps. Without this, every camera-lerp tick triggered a setViewport
  // → state change → effect re-run → rAF cancel + restart, which is the
  // "spider web vibration" the user reported.
  const viewportRef = React.useRef(viewport);
  React.useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // Surface every scale change to the parent so a zoom-percentage
  // indicator stays consistent across wheel zoom, pinch, and the +/−
  // buttons (which all flow through the same viewport state).
  React.useEffect(() => {
    onZoomChange?.(viewport.k);
  }, [viewport.k, onZoomChange]);
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
  React.useEffect(() => {
    activePathRef.current = activeNotePath;
  }, [activeNotePath]);

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
    // Pre-settle thoroughly so the graph is in equilibrium before first
    // paint. We then *stop stepping* in the render loop — running the
    // simulation continuously made the cluster look like a spider web in
    // the wind because every spring kept nudging neighbours by sub-pixel
    // amounts each frame. Dragging temporarily resumes stepping.
    for (let i = 0; i < 800; i++) layoutRef.current.step();
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

  // Selection never touches the layout. Both modes use the same force
  // layout; local just ghosts the non-active set in the renderer (see
  // drawScene + computeLocalSet). The render-loop's camera-follow pans
  // the viewport to the new active.

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
          // Only step while the user is dragging — the layout was already
          // pre-settled at mount and stays frozen otherwise, so the graph
          // doesn't wobble between renders.
          if (dragRef.current) {
            layout.step();
            hit?.rebuild([...layout.positions()]);
          }

          const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;

          // Camera focus: snap to the active note ONCE per selection, not
          // every frame. Continuous follow would fight user pan/wheel — they
          // could never drag the viewport because the next frame would snap
          // it back. centredOnRef remembers which active we last centred on;
          // we only re-centre when it changes.
          if (activeId && centredOnRef.current !== activeId) {
            const pos = layout.getPosition(activeId);
            if (pos) {
              const v = viewportRef.current;
              const next = { x: w / 2 - pos.x * v.k, y: h / 2 - pos.y * v.k, k: v.k };
              viewportRef.current = next;
              setViewport(next);
              centredOnRef.current = activeId;
            }
          } else if (!activeId) {
            centredOnRef.current = null;
          }
          const tiers = computeLocalTiers(graphData, activeId, layoutMode);
          const tierFor = (id: string): "primary" | "secondary" | "hidden" => {
            if (!tiers) return "primary"; // global mode: everything is primary
            if (tiers.primary.has(id)) return "primary";
            if (tiers.secondary.has(id)) return "secondary";
            return "hidden";
          };
          const scene: Scene = {
            transform: viewportRef.current,
            theme: detectTheme(),
            mode: layoutMode,
            showAllLabels,
            tokens: resolveTokens(canvas),
            // Skip hidden nodes entirely (3rd-tier+ in local mode).
            nodes: graphData.nodes
              .map((n) => ({ n, tier: tierFor(n.id) }))
              .filter((x) => x.tier !== "hidden")
              .map(({ n, tier }) => {
                const pos = layout.getPosition(n.id);
                return {
                  node: n,
                  position: pos ?? { id: n.id, x: 0, y: 0 },
                  isActive: n.id === activeId,
                  isHovered: n.id === hoverRef.current,
                  isStarred: !!(starredPaths && starredPaths.has(n.path)),
                  isShared: !!n.shared,
                  isVisible: !!pos,
                  tier,
                };
              }),
            // An edge is drawn if both endpoints are visible. Its tier is
            // the higher (more ghosted) of the two endpoints' tiers.
            edges: graphData.edges
              .map((e) => {
                const fromTier = tierFor(e.fromNoteId);
                const toTier = tierFor(e.toNoteId);
                if (fromTier === "hidden" || toTier === "hidden") return null;
                const fp = layout.getPosition(e.fromNoteId);
                const tp = layout.getPosition(e.toNoteId);
                if (!fp || !tp) return null;
                const tier: "primary" | "secondary" =
                  fromTier === "primary" && toTier === "primary"
                    ? "primary"
                    : "secondary";
                return {
                  fromPosition: fp,
                  toPosition: tp,
                  isActive: e.fromNoteId === activeId || e.toNoteId === activeId,
                  isHovered: e.fromNoteId === hoverRef.current || e.toNoteId === hoverRef.current,
                  tier,
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
    // viewport intentionally NOT in deps — read via viewportRef so the rAF
    // loop stays alive across camera-follow updates instead of being
    // cancelled and restarted every frame.
  }, [graphData, layoutMode, activeNotePath, starredPaths, setViewport, showAllLabels]);

  // Hover + click + drag from pointer events on the wrapper. We read the
  // viewport via viewportRef (kept in sync with React state) so the click
  // hit-test always sees the latest camera transform — even if the React
  // closure on this handler captured a stale viewport from before the most
  // recent camera-follow snap.
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const v = viewportRef.current;
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wx = (sx - v.x) / v.k;
    const wy = (sy - v.y) / v.k;
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
    const v = viewportRef.current;
    const wx = (e.clientX - rect.left - v.x) / v.k;
    const wy = (e.clientY - rect.top - v.y) / v.k;
    const id = hitRef.current?.test(wx, wy);
    if (id) {
      dragRef.current = { id, startX: e.clientX, startY: e.clientY };
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

/**
 * Compute the two visibility tiers for local mode:
 *   primary  = active + 1-hop  (drawn full colour)
 *   secondary = 2-hop neighbours (drawn as gray ghost dots)
 * Anything farther is hidden entirely.
 *
 * Returns null in global mode (every node is primary; no ghosting/hiding).
 */
function computeLocalTiers(
  data: GraphData, activeId: string | null, mode: LayoutMode,
): { primary: Set<string>; secondary: Set<string> } | null {
  if (mode !== "local" || !activeId) return null;
  const adj = new Map<string, Set<string>>();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const e of data.edges) {
    adj.get(e.fromNoteId)?.add(e.toNoteId);
    adj.get(e.toNoteId)?.add(e.fromNoteId);
  }
  const primary = new Set<string>([activeId]);
  for (const id of adj.get(activeId) ?? []) primary.add(id);
  const secondary = new Set<string>();
  for (const id of primary) {
    if (id === activeId) continue;
    for (const id2 of adj.get(id) ?? []) {
      if (!primary.has(id2)) secondary.add(id2);
    }
  }
  return { primary, secondary };
}
