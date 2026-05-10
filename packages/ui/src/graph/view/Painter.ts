import type { GraphNode } from "../types";
import type { NodePosition } from "../layout/types";

export interface ScenePainterStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  alpha?: number;
}

/**
 * Renderer-agnostic 2D painter. Both CanvasPainter (web/Tauri) and
 * SkiaPainter (RN) implement this surface. drawScene() is the only
 * caller — keep it minimal.
 */
export interface Painter {
  beginFrame(width: number, height: number): void;
  endFrame(): void;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(s: number): void;

  drawCircle(x: number, y: number, r: number, style: ScenePainterStyle): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, style: ScenePainterStyle): void;
  drawStar(x: number, y: number, outerR: number, innerR: number, points: number, style: ScenePainterStyle): void;
  drawText(x: number, y: number, text: string, fontSize: number, fontFamily: string, color: string, align?: "left" | "center" | "right"): void;
  measureText(text: string, fontSize: number, fontFamily: string): number;
}

/**
 * Local-mode tier:
 *   "primary"   = active note + its 1-hop neighbours (full colour)
 *   "secondary" = 2-hop neighbours (gray ghost dots)
 *   "hidden"    = farther than 2 hops — not drawn
 * In global mode every node is "primary" (no ghosting, no hiding).
 */
export type LocalTier = "primary" | "secondary" | "hidden";

export interface SceneNode {
  node: GraphNode;
  position: NodePosition;
  isActive: boolean;
  isHovered: boolean;
  isStarred: boolean;
  isShared: boolean;
  isVisible: boolean;
  tier: LocalTier;
}

export interface SceneEdge {
  fromPosition: NodePosition;
  toPosition: NodePosition;
  isActive: boolean;
  isHovered: boolean;
  tier: LocalTier;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Viewport transform. */
  transform: { x: number; y: number; k: number };
  /** "light" or "dark" — selects the palette in graphConfig.colors. */
  theme: "light" | "dark";
  /** Mode-aware: local mode ghosts non-set elements. */
  mode: "global" | "local";
  /** When true, draw every node's label. Otherwise labels render on hover/active only. */
  showAllLabels?: boolean;
  /** Optional design-token overrides resolved from CSS variables at draw time. */
  tokens?: {
    bg2: string;
    fg1: string;
    fg3: string;
    fg4: string;
    line: string;
    accent: string;
    accent2: string;
    accentSoft: string;
  };
}
