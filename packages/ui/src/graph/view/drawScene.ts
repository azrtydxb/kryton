// packages/ui/src/graph/view/drawScene.ts
import { GRAPH_CONFIG } from "../graphConfig";
import type { Painter, Scene, SceneEdge, SceneNode } from "./Painter";

export function drawScene(painter: Painter, scene: Scene, width: number, height: number): void {
  // Build the palette from design tokens when available so the canvas tracks
  // the live theme; fall back to the static GRAPH_CONFIG palette on platforms
  // that can't resolve CSS vars (e.g. native Skia).
  // Palette resolution mirrors prototype/app/graph.jsx exactly:
  //   edge default: --fg-4, active/hover: --accent
  //   node fill default: --bg-2, active: --accent
  //   node stroke default: --fg-3, active/hover: --accent
  //   halo: solid --accent at opacity 0.18, no stroke
  //   label default: --fg-1, active: --accent
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
      label: scene.tokens.fg1,
      labelActive: scene.tokens.accent,
      star: GRAPH_CONFIG.colors[scene.theme].star,
      starStroke: GRAPH_CONFIG.colors[scene.theme].starStroke,
      strokeDefault: scene.tokens.fg3,
      // Bible uses solid accent at 0.18 opacity — pass full-alpha accent
      // through and let drawCircle apply alpha 0.18 itself.
      activeHalo: scene.tokens.accent,
      ghostLine: scene.tokens.line,
    }
    : {
      ...GRAPH_CONFIG.colors[scene.theme],
      strokeDefault: GRAPH_CONFIG.colors[scene.theme].label,
      activeHalo: GRAPH_CONFIG.colors[scene.theme].nodeActive,
      labelActive: GRAPH_CONFIG.colors[scene.theme].nodeActive,
      ghostLine: GRAPH_CONFIG.colors[scene.theme].link,
    };

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
  ghostLine: string;
  node: string;
  nodeHovered: string;
  nodeActive: string;
  nodeShared: string;
  strokeActive: string;
  strokeShared: string;
  strokeHovered: string;
  label: string;
  labelActive: string;
  star: string;
  starStroke: string;
  strokeDefault: string;
  activeHalo: string;
}

// Per prototype/app/graph.jsx ~line 53-75:
//   ghost edge (local-mode secondary tier):
//     stroke=var(--line) strokeWidth=1 opacity=0.3
//   visible edge (primary tier):
//     stroke= active/hover ? var(--accent) : var(--fg-4)
//     strokeWidth= active/hover ? 1.5 : 1
//     opacity= active/hover ? 0.9 : 0.5
function drawEdge(p: Painter, e: SceneEdge, palette: Palette, mode: Scene["mode"]) {
  const ghosted = mode === "local" && e.tier === "secondary";
  if (ghosted) {
    p.drawLine(e.fromPosition.x, e.fromPosition.y, e.toPosition.x, e.toPosition.y, {
      stroke: palette.ghostLine, strokeWidth: 1, alpha: 0.3,
    });
    return;
  }
  const highlighted = e.isActive || e.isHovered;
  p.drawLine(e.fromPosition.x, e.fromPosition.y, e.toPosition.x, e.toPosition.y, {
    stroke: highlighted ? palette.strokeHovered : palette.link,
    strokeWidth: highlighted ? 1.5 : 1,
    alpha: highlighted ? 0.9 : 0.5,
  });
}

function drawNode(p: Painter, n: SceneNode, palette: Palette, mode: Scene["mode"], showAllLabels: boolean) {
  const ghosted = mode === "local" && n.tier === "secondary";
  const r = n.isActive
    ? GRAPH_CONFIG.node.activeRadius
    : n.isHovered
      ? GRAPH_CONFIG.node.hoveredRadius
      : GRAPH_CONFIG.node.defaultRadius;

  // Per prototype/app/graph.jsx ~line 78-81:
  //   {mode === 'local' && nodes.filter(n => !visibleIds.has(n.id)).map(n => (
  //     <circle ... r={n.r * 0.6} fill="var(--fg-4)" opacity="0.25"/>
  //   ))}
  // Ghost nodes are small dim dots with no label, no halo — exit early.
  if (ghosted) {
    p.drawCircle(n.position.x, n.position.y, r * 0.6, {
      fill: palette.link, // --fg-4 token
      stroke: palette.link,
      strokeWidth: 0,
      alpha: 0.25,
    });
    return;
  }
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

  // Per prototype/app/graph.jsx EditorMeta line ~99-106: labels render at
  //   y + n.r + 14
  //   fontSize = fullscreen ? 13 : 11
  //   fill = active ? --accent : --fg-1
  if ((n.isActive || n.isHovered || showAllLabels) && !ghosted) {
    const fontSize = showAllLabels ? 13 : 11;
    p.drawText(
      n.position.x,
      n.position.y + r + 14,
      truncate(n.node.title),
      fontSize,
      GRAPH_CONFIG.font.family,
      n.isActive ? palette.labelActive : palette.label,
      "center",
    );
  }
}

function truncate(s: string): string {
  if (s.length <= GRAPH_CONFIG.label.maxLength) return s;
  return s.slice(0, GRAPH_CONFIG.label.truncatedLength) + GRAPH_CONFIG.label.ellipsis;
}
