// packages/ui/src/graph/gestures/useViewport.web.ts
import { useEffect, useRef, useState } from "react";
import { GRAPH_CONFIG } from "../graphConfig";

export interface Viewport { x: number; y: number; k: number }

export function clampScale(k: number): number {
  return Math.max(GRAPH_CONFIG.zoom.scaleMin, Math.min(GRAPH_CONFIG.zoom.scaleMax, k));
}

export function applyWheelZoom(v: Viewport, deltaY: number, focalX: number, focalY: number): Viewport {
  const factor = Math.exp(-deltaY / 300);
  const k = clampScale(v.k * factor);
  // Keep focal world-point stationary on screen.
  const worldX = (focalX - v.x) / v.k;
  const worldY = (focalY - v.y) / v.k;
  return { k, x: focalX - worldX * k, y: focalY - worldY * k };
}

export function applyPanDelta(v: Viewport, dx: number, dy: number): Viewport {
  return { x: v.x + dx, y: v.y + dy, k: v.k };
}

export interface UseViewportResult {
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  bind: (el: HTMLElement | null) => void;
}

export function useViewport(): UseViewportResult {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const elRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startV: Viewport } | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      setViewport((v) => applyWheelZoom(v, e.deltaY, e.clientX - rect.left, e.clientY - rect.top));
    }
    function onPointerDown(e: PointerEvent) {
      el!.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, startV: viewport };
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setViewport(applyPanDelta(dragRef.current.startV, dx, dy));
    }
    function onPointerUp(e: PointerEvent) {
      if (!dragRef.current) return;
      el!.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [viewport]);

  return { viewport, setViewport, bind: (el) => { elRef.current = el; } };
}
