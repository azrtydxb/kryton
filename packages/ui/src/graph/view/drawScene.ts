// packages/ui/src/graph/view/drawScene.ts
import { GRAPH_CONFIG } from "../graphConfig";
import type { Painter, Scene, SceneEdge, SceneNode } from "./Painter";

export function drawScene(painter: Painter, scene: Scene, width: number, height: number): void {
  const palette = GRAPH_CONFIG.colors[scene.theme];
  painter.beginFrame(width, height);
  painter.save();
  painter.translate(scene.transform.x, scene.transform.y);
  painter.scale(scene.transform.k);

  // Edges first so nodes paint over them.
  for (const e of scene.edges) drawEdge(painter, e, palette, scene.mode);
  for (const n of scene.nodes) drawNode(painter, n, palette, scene.mode);

  painter.restore();
  painter.endFrame();
}

type Palette = typeof GRAPH_CONFIG.colors.light | typeof GRAPH_CONFIG.colors.dark;

function drawEdge(p: Painter, e: SceneEdge, palette: Palette, mode: Scene["mode"]) {
  const ghosted = mode === "local" && !e.isInLocalSet;
  const stroke = e.isActive || e.isHovered ? palette.strokeHovered : palette.link;
  const alpha = ghosted ? 0.2 : e.isActive || e.isHovered ? 0.9 : 0.5;
  const strokeWidth = e.isActive || e.isHovered ? 1.5 : 1;
  p.drawLine(e.fromPosition.x, e.fromPosition.y, e.toPosition.x, e.toPosition.y, {
    stroke, strokeWidth, alpha,
  });
}

function drawNode(p: Painter, n: SceneNode, palette: Palette, mode: Scene["mode"]) {
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
  const stroke = n.isActive
    ? palette.strokeActive
    : n.isShared
      ? palette.strokeShared
      : n.isHovered
        ? palette.strokeHovered
        : fill;
  const baseStyle = { fill, stroke, strokeWidth: n.isActive ? 2 : 1.2, alpha: ghosted ? 0.25 : 1 };

  if (n.isStarred && !n.isActive && !ghosted) {
    const outerR = n.isHovered ? GRAPH_CONFIG.node.starHoveredRadius : GRAPH_CONFIG.node.starDefaultRadius;
    const innerR = outerR * GRAPH_CONFIG.node.starInnerRadiusRatio;
    p.drawStar(n.position.x, n.position.y, outerR, innerR, 5, {
      fill: palette.star, stroke: palette.starStroke, strokeWidth: 1, alpha: 1,
    });
  } else {
    p.drawCircle(n.position.x, n.position.y, r, baseStyle);
  }

  if ((n.isActive || n.isHovered) && !ghosted) {
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
