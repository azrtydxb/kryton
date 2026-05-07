import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { GraphData, HoveredNodeInfo } from "./types";
import { GRAPH_CONFIG } from "./graphConfig";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  path: string;
  shared?: boolean;
  ownerUserId?: string;
  hopDistance?: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

export interface UseD3GraphOptions {
  activeNotePath: string | null;
  mode: "local" | "full";
  starredPaths?: Set<string>;
  onNodeClick: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
}

function computeHopDistances(
  sourceId: string,
  edges: { fromNoteId: string; toNoteId: string }[],
  maxHops: number,
): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    let neighbors1 = adjacency.get(edge.fromNoteId);
    if (!neighbors1) {
      neighbors1 = [];
      adjacency.set(edge.fromNoteId, neighbors1);
    }
    neighbors1.push(edge.toNoteId);

    let neighbors2 = adjacency.get(edge.toNoteId);
    if (!neighbors2) {
      neighbors2 = [];
      adjacency.set(edge.toNoteId, neighbors2);
    }
    neighbors2.push(edge.fromNoteId);
  }

  const distances = new Map<string, number>();
  distances.set(sourceId, 0);
  const queue = [sourceId];
  let idx = 0;

  while (idx < queue.length) {
    const current = queue[idx++] as string;
    const currentDist = distances.get(current) ?? 0;
    if (currentDist >= maxHops) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

export function useD3Graph(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  graphData: GraphData | null,
  options: UseD3GraphOptions,
): void {
  const { activeNotePath, mode, starredPaths, onNodeClick, onNodeHover, recenterRef } =
    options;
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink>>(undefined);
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);

  const handleNodeClick = useCallback(
    (node: SimNode) => {
      if (node.shared && node.ownerUserId) {
        onNodeClick(`shared:${node.ownerUserId}:${node.path}`);
      } else {
        onNodeClick(node.path);
      }
    },
    [onNodeClick],
  );

  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cfg = GRAPH_CONFIG;

    let filteredNodes = graphData.nodes;
    let filteredEdges = graphData.edges;
    let hopDistances: Map<string, number> | null = null;

    if (mode === "local" && activeNotePath) {
      const activeNodeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id;
      if (activeNodeId) {
        hopDistances = computeHopDistances(activeNodeId, graphData.edges, 2);
        const includedIds = new Set(hopDistances.keys());
        filteredNodes = graphData.nodes.filter((n) => includedIds.has(n.id));
        filteredEdges = graphData.edges.filter(
          (e) => includedIds.has(e.fromNoteId) && includedIds.has(e.toNoteId),
        );
      }
    }

    /**
     * Resolve graph colours from the design-token CSS variables so the
     * rendering tracks the user's theme (dark/light) and accent choice
     * verbatim from prototype/styles/tokens.css. Recomputed each draw
     * so live theme/accent toggles take effect immediately.
     */
    const tokens = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string) => cs.getPropertyValue(name).trim();
      return {
        accent: v("--accent"),
        accentSoft: v("--accent-soft"),
        bg2: v("--bg-2"),
        fg1: v("--fg-1"),
        fg3: v("--fg-3"),
        fg4: v("--fg-4"),
        line: v("--line"),
        starFill: v("--accent-warn"),
      };
    };
    const colors = cfg.colors[document.documentElement.classList.contains("dark") ? "dark" : "light"];

    let currentWidth = 0;
    let currentHeight = 0;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        currentWidth = rect.width;
        currentHeight = rect.height;
      }
    };
    resize();

    const nodes: SimNode[] = filteredNodes.map((n) => ({
      ...n,
      hopDistance: hopDistances?.get(n.id) ?? undefined,
    }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const links: SimLink[] = filteredEdges
      .filter((e) => nodeMap.has(e.fromNoteId) && nodeMap.has(e.toNoteId))
      .map((e) => ({ source: e.fromNoteId, target: e.toNoteId }));

    nodesRef.current = nodes;
    linksRef.current = links;

    const cx = currentWidth / 2;
    const cy = currentHeight / 2;
    const minDim = Math.min(currentWidth, currentHeight);

    const effectiveAlphaDecay =
      nodes.length > cfg.simulation.largeGraphThreshold
        ? cfg.simulation.alphaDecayLargeGraph
        : cfg.simulation.alphaDecay;

    const simulation = d3
      .forceSimulation(nodes)
      .alphaDecay(effectiveAlphaDecay)
      .velocityDecay(cfg.simulation.velocityDecay);

    const activeNode = activeNotePath
      ? nodes.find((n) => n.path === activeNotePath)
      : null;
    const useLocalLayout = mode === "local" && activeNode != null;

    if (useLocalLayout) {
      const localCfg = cfg.simulation.local;

      activeNode.fx = cx;
      activeNode.fy = cy;
      activeNode.x = cx;
      activeNode.y = cy;

      const ring1Nodes = nodes.filter((n) => n.hopDistance === 1);
      const ring2Nodes = nodes.filter((n) => n.hopDistance === 2);
      const r1 = minDim * localCfg.ring1Ratio;
      const r2 = minDim * localCfg.ring2Ratio;

      ring1Nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / ring1Nodes.length - Math.PI / 2;
        n.x = cx + Math.cos(angle) * r1;
        n.y = cy + Math.sin(angle) * r1;
      });

      ring2Nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(ring2Nodes.length, 1) - Math.PI / 2;
        n.x = cx + Math.cos(angle) * r2;
        n.y = cy + Math.sin(angle) * r2;
      });

      simulation
        .force(
          "link",
          d3
            .forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(localCfg.linkDistance),
        )
        .force("charge", d3.forceManyBody().strength(localCfg.chargeStrength))
        .force("collision", d3.forceCollide().radius(localCfg.collisionRadius))
        .force(
          "radial",
          d3
            .forceRadial<SimNode>(
              (d) => {
                if (d.hopDistance === 0) return 0;
                if (d.hopDistance === 1) return r1;
                return r2;
              },
              cx,
              cy,
            )
            .strength(localCfg.radialStrength),
        );
    } else {
      const globalCfg = cfg.simulation.global;

      simulation
        .force(
          "link",
          d3
            .forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(globalCfg.linkDistance),
        )
        .force("charge", d3.forceManyBody().strength(globalCfg.chargeStrength))
        .force("center", d3.forceCenter(cx, cy))
        .force("collision", d3.forceCollide().radius(globalCfg.collisionRadius));

      // Pin the active node to the canvas centre regardless of mode — per
      // the design guide the selected note always sits dead-centre with
      // its neighbours radiating around it.
      if (activeNode) {
        activeNode.fx = cx;
        activeNode.fy = cy;
        activeNode.x = cx;
        activeNode.y = cy;
      }
    }

    simulationRef.current = simulation;

    function draw() {
      if (!ctx) return;
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      const c = tokens();

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      const t = transformRef.current;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Edges — per prototype/app/graph.jsx: edges incident to the
      // active/hovered node use var(--accent) at 0.9 opacity & width 1.5;
      // all other edges use var(--fg-4) at 0.5 opacity & width 1.
      const hovered = hoveredNodeRef.current;
      for (const link of links) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (
          source.x === undefined ||
          source.y === undefined ||
          target.x === undefined ||
          target.y === undefined
        )
          continue;
        const incidentToActive =
          activeNotePath != null &&
          (source.path === activeNotePath || target.path === activeNotePath);
        const incidentToHover =
          hovered != null && (source === hovered || target === hovered);
        const accented = incidentToActive || incidentToHover;
        ctx.globalAlpha = accented ? 0.9 : 0.5;
        ctx.strokeStyle = accented ? c.accent : c.fg4;
        ctx.lineWidth = accented ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes — per prototype:
      //   active : fill var(--accent), stroke var(--accent), strokeWidth 2,
      //            soft halo (r+6) at var(--accent) / 0.18 opacity
      //   other  : fill var(--bg-2), stroke var(--fg-3), strokeWidth 1.2
      //   hover  : same shape as default but stroke var(--accent)
      //   label  : active → var(--accent); else var(--fg-1)
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        const isHovered = hoveredNodeRef.current === node;
        const isActive = node.path === activeNotePath;
        const isStarred = starredPaths?.has(node.path) ?? false;
        const isShared = node.shared === true;
        const radius = isActive
          ? cfg.node.activeRadius
          : isHovered
            ? cfg.node.hoveredRadius
            : cfg.node.defaultRadius;

        if (isStarred && !isActive) {
          const r = isHovered ? cfg.node.starHoveredRadius : cfg.node.starDefaultRadius;
          const innerR = r * cfg.node.starInnerRadiusRatio;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const angle = Math.PI / 2 + (i * Math.PI) / 5;
            const dist = i % 2 === 0 ? r : innerR;
            const px = node.x + Math.cos(angle) * dist;
            const py = node.y - Math.sin(angle) * dist;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = c.starFill;
          ctx.fill();
          ctx.strokeStyle = c.fg3;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          // Halo for active / hovered nodes (accent at 0.18 opacity).
          if (isActive || isHovered) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, 2 * Math.PI);
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = c.accent;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isActive ? c.accent : isShared ? colors.nodeShared : c.bg2;
          ctx.fill();
          ctx.strokeStyle = isActive
            ? c.accent
            : isHovered
              ? c.accent
              : isShared
                ? colors.strokeShared
                : c.fg3;
          ctx.lineWidth = isActive ? 2 : 1.2;
          ctx.stroke();
        }

        // Label — only render for active / hovered nodes per prototype
        // (in fullscreen mode prototype shows all labels, but rail-mode
        // hides them until interaction).
        if (isActive || isHovered) {
          const fontSize = cfg.font.activeSize;
          ctx.font = `${fontSize}px ${cfg.font.family}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isActive ? c.accent : c.fg1;
          const label =
            node.title.length > cfg.label.maxLength
              ? node.title.slice(0, cfg.label.truncatedLength) + cfg.label.ellipsis
              : node.title;
          ctx.fillText(label, node.x, node.y + radius + cfg.node.labelOffset);
        }
      }

      ctx.restore();
    }

    simulation.on("tick", draw);

    transformRef.current = d3.zoomIdentity;

    function getNodeAt(mx: number, my: number): SimNode | null {
      const t = transformRef.current;
      const x = (mx - t.x) / t.k;
      const y = (my - t.y) / t.k;
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        const dx = x - node.x;
        const dy = y - node.y;
        if (dx * dx + dy * dy < cfg.node.hitTestRadiusSq) return node;
      }
      return null;
    }

    const d3Canvas = d3.select(canvas);
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([cfg.zoom.scaleMin, cfg.zoom.scaleMax])
      .filter((event) => {
        if (event.type === "mousedown") {
          const rect = canvas.getBoundingClientRect();
          const node = getNodeAt(
            event.clientX - rect.left,
            event.clientY - rect.top,
          );
          if (node) return false;
        }
        return true;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });

    d3Canvas.call(zoom);
    zoomRef.current = zoom;

    if (recenterRef) {
      recenterRef.current = () => {
        transformRef.current = d3.zoomIdentity;
        d3Canvas
          .transition()
          .duration(cfg.zoom.recenterDuration)
          .call(zoom.transform, d3.zoomIdentity);
      };
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node !== hoveredNodeRef.current) {
        hoveredNodeRef.current = node;
        canvas.style.cursor = node ? "pointer" : "default";
        draw();
        onNodeHover?.(
          node
            ? { path: node.path, title: node.title, x: e.clientX, y: e.clientY }
            : null,
        );
      }
    };

    const handleMouseClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) handleNodeClick(node);
    };

    let dragNode: SimNode | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        dragNode = node;
        simulation.alphaTarget(cfg.simulation.dragAlphaTarget).restart();
        d3Canvas.on(".zoom", null);
      }
    };

    const handleMouseDrag = (e: MouseEvent) => {
      if (!dragNode) return;
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      dragNode.fx = (e.clientX - rect.left - t.x) / t.k;
      dragNode.fy = (e.clientY - rect.top - t.y) / t.k;
    };

    const handleMouseUp = () => {
      if (dragNode) {
        // Active node stays pinned (centred); other nodes return to free.
        if (dragNode.path !== activeNotePath) {
          dragNode.fx = null;
          dragNode.fy = null;
        }
        dragNode = null;
        simulation.alphaTarget(0);
        d3Canvas.call(zoom);
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleMouseClick);
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseDrag);
    window.addEventListener("mouseup", handleMouseUp);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      const newCx = currentWidth / 2;
      const newCy = currentHeight / 2;
      const newMinDim = Math.min(currentWidth, currentHeight);

      if (useLocalLayout) {
        if (activeNode) {
          activeNode.fx = newCx;
          activeNode.fy = newCy;
        }
        simulation.force(
          "radial",
          d3
            .forceRadial<SimNode>(
              (d) => {
                if (d.hopDistance === 0) return 0;
                if (d.hopDistance === 1)
                  return newMinDim * cfg.simulation.local.ring1Ratio;
                return newMinDim * cfg.simulation.local.ring2Ratio;
              },
              newCx,
              newCy,
            )
            .strength(cfg.simulation.local.radialStrength),
        );
      } else {
        simulation.force("center", d3.forceCenter(newCx, newCy));
        if (activeNode) {
          activeNode.fx = newCx;
          activeNode.fy = newCy;
        }
      }
      simulation.alpha(cfg.simulation.resizeAlpha).restart();
    });

    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    return () => {
      simulation.stop();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleMouseClick);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseDrag);
      window.removeEventListener("mouseup", handleMouseUp);
      resizeObserver.disconnect();
    };
  }, [
    graphData,
    mode,
    activeNotePath,
    handleNodeClick,
    onNodeHover,
    recenterRef,
    starredPaths,
    canvasRef,
  ]);
}
