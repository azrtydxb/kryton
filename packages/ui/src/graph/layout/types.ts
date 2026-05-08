import type { GraphNode, GraphEdge } from "../types";

export type LayoutMode = "global" | "local";

export interface LayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: LayoutMode;
  activeId: string | null;
  width: number;
  height: number;
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

/**
 * Renderer-agnostic handle to a running layout. Drives one tick at a time;
 * the caller (web raf loop or RN useFrameCallback) decides cadence.
 */
export interface LayoutHandle {
  /** Advance the simulation by one tick. Cheap; safe to call every frame. */
  step(): void;
  /** Current position of a node, or undefined if the id is unknown. */
  getPosition(id: string): NodePosition | undefined;
  /** Iterate all current positions. */
  positions(): IterableIterator<NodePosition>;
  /** Pin a node to (x, y); subsequent steps treat it as fixed. */
  pin(id: string, x: number, y: number): void;
  /** Release a previously-pinned node. */
  unpin(id: string): void;
  /** Inject kinetic energy after a structural change. */
  reheat(alpha: number): void;
  /** Update viewport bounds; the layout may rescale ring radii etc. */
  setBounds(width: number, height: number): void;
  /** Tear down internal state, free references. */
  dispose(): void;
}
