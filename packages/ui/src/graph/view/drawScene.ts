// packages/ui/src/graph/view/drawScene.ts
import { GRAPH_CONFIG } from "../graphConfig";
import type { Painter, Scene, SceneEdge, SceneNode } from "./Painter";

export function drawScene(painter: Painter, scene: Scene, width: number, height: number): void {
  // Build the palette from design tokens when available so the canvas tracks
  // the live theme; fall back to the static GRAPH_CONFIG palette on platforms
  // that can't resolve CSS vars (e.g. native Skia).
  const palette: Palette = scene.tokens
    ? {
      link: scene.tokens.fg4,
      node: scene.tokens.bg2,
      nodeHovered: scene.tokens.bg2,
      nodeActive: scene.tokens.accent,
      nodeShared: scene.tokens.accent2,
      strokeActive: scene.tokens.accent,
      strokeShared: scene.tokens.accent2,
      strokeHovered: scene.tokens.accent,
      label: scene.tokens.fg3,
      star: GRAPH_CONFIG.colors[scene.theme].star,
      starStroke: GRAPH_CONFIG.colors[scene.theme].starStroke,
      strokeDefault: scene.tokens.fg3,
      activeHalo: scene.tokens.accentSoft,
    }
    : { ...GRAPH_CONFIG.colors[scene.theme], strokeDefault: GRAPH_CONFIG.colors[scene.theme].label, activeHalo: GRAPH_CONFIG.colors[scene.theme].nodeActive };

  painter.beginFrame(width, height);
  painter.save();
  painter.translate(scene.transform.x, scene.transform.y);
  painter.scale(scene.transform.k);

  // Edges first so nodes paint over them.
  for (const e of scene.edges) drawEdge(painter, e, palette, scene.mode);
  for (const n of scene.nodes) drawNode(painter, n, palette, scene.mode, !!scene.showAllLabels);

  painter.restore();
  painter.endFrame();
}

interface Palette {
  link: string;
  node: string;
  nodeHovered: string;
  nodeActive: string;
  nodeShared: string;
  strokeActive: string;
  strokeShared: string;
  strokeHovered: string;
  label: string;
  star: string;
  starStroke: string;
  strokeDefault: string;
  activeHalo: string;
}

function drawEdge(p: Painter, e: SceneEdge, palette: Palette, mode: Scene["mode"]) {
  const ghosted = mode === "local" && !e.isInLocalSet;
  const stroke = e.isActive || e.isHovered ? palette.strokeHovered : palette.link;
  const alpha = ghosted ? 0.2 : e.isActive || e.isHovered ? 0.9 : 0.5;
  const strokeWidth = e.isActive || e.isHovered ? 1.5 : 1;
  p.drawLine(e.fromPosition.x, e.fromPosition.y, e.toPosition.x, e.toPosition.y, {
    stroke, strokeWidth, alpha,
  });
}

function drawNode(p: Painter, n: SceneNode, palette: Palette, mode: Scene["mode"], showAllLabels: boolean) {
  const ghosted = mode === "local" && !n.isInLocalSet;
  const r = n.isActive
    ? GRAPH_CONFIG.node.activeRadius
    : n.isHovered
      ? GRAPH_CONFIG.node.hoveredRadius
      : GRAPH_CONFIG.node.defaultRadius;
  const fill = n.isActive
    ? palette.nodeActive
    : n.isShared
      ? palette.nodeShared
      : palette.node;
  // Per prototype/app/graph.jsx: default nodes use --bg-2 fill with a --fg-3
  // stroke; hovered nodes swap to an --accent stroke. Active nodes get a
  // halo (drawn first so the solid node sits on top).
  const stroke = n.isActive
    ? palette.strokeActive
    : n.isShared
      ? palette.strokeShared
      : n.isHovered
        ? palette.strokeHovered
        : palette.strokeDefault;
  const baseStyle = { fill, stroke, strokeWidth: n.isActive ? 2 : 1.2, alpha: ghosted ? 0.25 : 1 };

  if ((n.isActive || n.isHovered) && !ghosted && !n.isStarred) {
    p.drawCircle(n.position.x, n.position.y, r + 6, {
      fill: palette.activeHalo,
      stroke: palette.activeHalo,
      strokeWidth: 0,
      alpha: 0.18,
    });
  }

  if (n.isStarred && !n.isActive && !ghosted) {
    const outerR = n.isHovered ? GRAPH_CONFIG.node.starHoveredRadius : GRAPH_CONFIG.node.starDefaultRadius;
    const innerR = outerR * GRAPH_CONFIG.node.starInnerRadiusRatio;
    p.drawStar(n.position.x, n.position.y, outerR, innerR, 5, {
      fill: palette.star, stroke: palette.starStroke, strokeWidth: 1, alpha: 1,
    });
  } else {
    p.drawCircle(n.position.x, n.position.y, r, baseStyle);
  }

  if ((n.isActive || n.isHovered || showAllLabels) && !ghosted) {
    p.drawText(
      n.position.x,
      n.position.y + r + GRAPH_CONFIG.node.labelOffset + GRAPH_CONFIG.font.defaultSize,
      truncate(n.node.title),
      n.isActive ? GRAPH_CONFIG.font.activeSize : GRAPH_CONFIG.font.defaultSize,
      GRAPH_CONFIG.font.family,
      palette.label,
      "center",
    );
  }
}

function truncate(s: string): string {
  if (s.length <= GRAPH_CONFIG.label.maxLength) return s;
  return s.slice(0, GRAPH_CONFIG.label.truncatedLength) + GRAPH_CONFIG.label.ellipsis;
}
