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
}

export function GraphView({
  graphData, loading = false, activeNotePath = null, mode = "full",
  onNoteSelect, onNodeHover, recenterRef, starredPaths, className,
}: GraphViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const layoutRef = React.useRef<LayoutHandle | null>(null);
  const hitRef = React.useRef<HitTest | null>(null);
  const hoverRef = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ id: string } | null>(null);
  const { viewport, bind, setViewport } = useViewport();
  const layoutMode: LayoutMode = mode === "full" ? "global" : "local";

  // Build / rebuild layout when graphData, mode, or activeNotePath changes.
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
    hitRef.current = createHitTest(
      [...layoutRef.current.positions()],
      Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
    );
  }, [graphData, layoutMode, activeNotePath]);

  // Recenter handle.
  React.useEffect(() => {
    if (!recenterRef) return;
    recenterRef.current = () => setViewport({ x: 0, y: 0, k: 1 });
  }, [recenterRef, setViewport]);

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
          layout.step();
          hit?.rebuild([...layout.positions()]);

          const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
          const localSet = computeLocalSet(graphData, activeId, layoutMode);
          const scene: Scene = {
            transform: viewport,
            theme: detectTheme(),
            mode: layoutMode,
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
      dragRef.current = { id };
      applyDragStart(layoutRef.current!, id, wx, wy);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      // If the pointer didn't move much, treat as click.
      applyDragEnd(layoutRef.current!, dragRef.current.id);
      const node = graphData?.nodes.find((n) => n.id === dragRef.current!.id);
      if (node) onNoteSelect(node.path);
      dragRef.current = null;
      void e;
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
