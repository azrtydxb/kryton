import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphData } from '../../lib/api';
import { GRAPH_CONFIG } from './graphConfig';

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  path: string;
  shared?: boolean;
  ownerUserId?: string;
  hopDistance?: number; // distance from active node (local mode)
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

export interface HoveredNodeInfo {
  path: string;
  title: string;
  x: number;
  y: number;
}

interface UseD3GraphOptions {
  activeNotePath: string | null;
  mode: 'local' | 'full';
  starredPaths?: Set<string>;
  onNodeClick: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
}

/**
 * Compute hop distances from a source node using BFS with adjacency map.
 * O(V+E) — builds adjacency list once, then BFS traversal.
 */
function computeHopDistances(
  sourceId: string,
  edges: { fromNoteId: string; toNoteId: string }[],
  maxHops: number
): Map<string, number> {
  // Build adjacency map once
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    let neighbors = adjacency.get(edge.fromNoteId);
    if (!neighbors) { neighbors = []; adjacency.set(edge.fromNoteId, neighbors); }
    neighbors.push(edge.toNoteId);

    neighbors = adjacency.get(edge.toNoteId);
    if (!neighbors) { neighbors = []; adjacency.set(edge.toNoteId, neighbors); }
    neighbors.push(edge.fromNoteId);
  }

  const distances = new Map<string, number>();
  distances.set(sourceId, 0);
  const queue = [sourceId];
  let idx = 0;

  while (idx < queue.length) {
    const current = queue[idx++];
    const currentDist = distances.get(current)!;
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
  const { activeNotePath, mode, starredPaths, onNodeClick, onNodeHover, recenterRef } = options;
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink>>(undefined);
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);

  const handleNodeClick = useCallback((node: SimNode) => {
    if (node.shared && node.ownerUserId) {
      onNodeClick(`shared:${node.ownerUserId}:${node.path}`);
    } else {
      onNodeClick(node.path);
    }
  }, [onNodeClick]);

  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cfg = GRAPH_CONFIG;

    // Filter for local mode (2-hop neighborhood)
    let filteredNodes = graphData.nodes;
    let filteredEdges = graphData.edges;
    let hopDistances: Map<string, number> | null = null;

    if (mode === 'local' && activeNotePath) {
      const activeNodeId = graphData.nodes.find(n => n.path === activeNotePath)?.id;
      if (activeNodeId) {
        hopDistances = computeHopDistances(activeNodeId, graphData.edges, 2);
        const includedIds = new Set(hopDistances.keys());
        filteredNodes = graphData.nodes.filter(n => includedIds.has(n.id));
        filteredEdges = graphData.edges.filter(
          e => includedIds.has(e.fromNoteId) && includedIds.has(e.toNoteId)
        );
      }
    }

    const isDark = document.documentElement.classList.contains('dark');
    const colors = isDark ? cfg.colors.dark : cfg.colors.light;

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

    const nodes: SimNode[] = filteredNodes.map(n => ({
      ...n,
      hopDistance: hopDistances?.get(n.id) ?? undefined,
    }));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links: SimLink[] = filteredEdges
      .filter(e => nodeMap.has(e.fromNoteId) && nodeMap.has(e.toNoteId))
      .map(e => ({
        source: e.fromNoteId,
        target: e.toNoteId,
      }));

    nodesRef.current = nodes;
    linksRef.current = links;

    const cx = currentWidth / 2;
    const cy = currentHeight / 2;
    const minDim = Math.min(currentWidth, currentHeight);

    // Adaptive alpha decay — slower for small graphs (smooth), faster for large (CPU)
    const effectiveAlphaDecay = nodes.length > cfg.simulation.largeGraphThreshold
      ? cfg.simulation.alphaDecayLargeGraph
      : cfg.simulation.alphaDecay;

    const simulation = d3.forceSimulation(nodes)
      .alphaDecay(effectiveAlphaDecay)
      .velocityDecay(cfg.simulation.velocityDecay);

    // Determine effective layout mode — fall back to global if active node not found in local
    const activeNode = activeNotePath ? nodes.find(n => n.path === activeNotePath) : null;
    const useLocalLayout = mode === 'local' && activeNode !== null && activeNode !== undefined;

    if (useLocalLayout) {
      const localCfg = cfg.simulation.local;

      // Pin active node at center
      activeNode.fx = cx;
      activeNode.fy = cy;
      activeNode.x = cx;
      activeNode.y = cy;

      // Initialize ring nodes at evenly spaced angles to minimize edge crossings
      const ring1Nodes = nodes.filter(n => n.hopDistance === 1);
      const ring2Nodes = nodes.filter(n => n.hopDistance === 2);
      const r1 = minDim * localCfg.ring1Ratio;
      const r2 = minDim * localCfg.ring2Ratio;

      ring1Nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / ring1Nodes.length - Math.PI / 2;
        n.x = cx + Math.cos(angle) * r1;
        n.y = cy + Math.sin(angle) * r1;
      });

      // Place ring 2 nodes near their ring 1 connections
      ring2Nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(ring2Nodes.length, 1) - Math.PI / 2;
        n.x = cx + Math.cos(angle) * r2;
        n.y = cy + Math.sin(angle) * r2;
      });

      simulation
        .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(localCfg.linkDistance))
        .force('charge', d3.forceManyBody().strength(localCfg.chargeStrength))
        .force('collision', d3.forceCollide().radius(localCfg.collisionRadius))
        .force('radial', d3.forceRadial<SimNode>(
          (d) => {
            if (d.hopDistance === 0) return 0;
            if (d.hopDistance === 1) return r1;
            return r2;
          },
          cx,
          cy
        ).strength(localCfg.radialStrength));
    } else {
      // Global (full) mode
      const globalCfg = cfg.simulation.global;

      simulation
        .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(globalCfg.linkDistance))
        .force('charge', d3.forceManyBody().strength(globalCfg.chargeStrength))
        .force('center', d3.forceCenter(cx, cy))
        .force('collision', d3.forceCollide().radius(globalCfg.collisionRadius));

      // Soft radial pull for active node toward center
      if (activeNode) {
        simulation.force('activeRadial', d3.forceRadial<SimNode>(
          0, cx, cy
        ).strength((d) => d.path === activeNotePath ? globalCfg.activeRadialStrength : 0));
      }
    }

    simulationRef.current = simulation;

    function draw() {
      if (!ctx) return;
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      const t = transformRef.current;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Draw links
      ctx.strokeStyle = colors.link;
      ctx.lineWidth = 1;
      for (const link of links) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        const isHovered = hoveredNodeRef.current === node;
        const isActive = node.path === activeNotePath;
        const isStarred = starredPaths?.has(node.path) ?? false;
        const isShared = node.shared === true;
        const radius = isActive ? cfg.node.activeRadius : isHovered ? cfg.node.hoveredRadius : cfg.node.defaultRadius;

        if (isStarred && !isActive) {
          const r = isHovered ? cfg.node.starHoveredRadius : cfg.node.starDefaultRadius;
          const innerR = r * cfg.node.starInnerRadiusRatio;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const angle = (Math.PI / 2) + (i * Math.PI / 5);
            const dist = i % 2 === 0 ? r : innerR;
            const px = node.x + Math.cos(angle) * dist;
            const py = node.y - Math.sin(angle) * dist;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = colors.star;
          ctx.fill();
          ctx.strokeStyle = colors.starStroke;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isActive
            ? colors.nodeActive
            : isShared
              ? colors.nodeShared
              : isHovered
                ? colors.nodeHovered
                : colors.node;
          ctx.fill();

          if (isHovered || isActive || isShared) {
            ctx.strokeStyle = isActive
              ? colors.strokeActive
              : isShared
                ? colors.strokeShared
                : colors.strokeHovered;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        // Label
        const fontSize = isHovered || isActive ? cfg.font.activeSize : cfg.font.defaultSize;
        ctx.font = `${fontSize}px ${cfg.font.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = colors.label;
        const label = node.title.length > cfg.label.maxLength
          ? node.title.slice(0, cfg.label.truncatedLength) + cfg.label.ellipsis
          : node.title;
        ctx.fillText(label, node.x, node.y + radius + cfg.node.labelOffset);
      }

      ctx.restore();
    }

    simulation.on('tick', draw);

    // Reset zoom to identity
    transformRef.current = d3.zoomIdentity;

    // Hit-test helper (defined early so zoom filter can use it)
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

    // Zoom + pan — filter out mousedown on nodes so drag works
    const d3Canvas = d3.select(canvas);
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([cfg.zoom.scaleMin, cfg.zoom.scaleMax])
      .filter((event) => {
        // Allow wheel zoom always, but block pan-start on nodes
        if (event.type === 'mousedown') {
          const rect = canvas.getBoundingClientRect();
          const node = getNodeAt(event.clientX - rect.left, event.clientY - rect.top);
          if (node) return false; // don't start zoom/pan on a node
        }
        return true;
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });

    d3Canvas.call(zoom);
    zoomRef.current = zoom;

    // Expose recenter function
    if (recenterRef) {
      recenterRef.current = () => {
        transformRef.current = d3.zoomIdentity;
        d3Canvas.transition().duration(cfg.zoom.recenterDuration).call(zoom.transform, d3.zoomIdentity);
      };
    }

    // Hover
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node !== hoveredNodeRef.current) {
        hoveredNodeRef.current = node;
        canvas.style.cursor = node ? 'pointer' : 'default';
        draw();
        onNodeHover?.(node ? { path: node.path, title: node.title, x: e.clientX, y: e.clientY } : null);
      }
    };

    // Click
    const handleMouseClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) handleNodeClick(node);
    };

    // Drag
    let dragNode: SimNode | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        dragNode = node;
        simulation.alphaTarget(cfg.simulation.dragAlphaTarget).restart();
        d3Canvas.on('.zoom', null);
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
        // Don't unpin active node in local mode
        if (!(useLocalLayout && dragNode.path === activeNotePath)) {
          dragNode.fx = null;
          dragNode.fy = null;
        }
        dragNode = null;
        simulation.alphaTarget(0);
        d3Canvas.call(zoom);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleMouseClick);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseDrag);
    window.addEventListener('mouseup', handleMouseUp);

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
        simulation.force('radial', d3.forceRadial<SimNode>(
          (d) => {
            if (d.hopDistance === 0) return 0;
            if (d.hopDistance === 1) return newMinDim * cfg.simulation.local.ring1Ratio;
            return newMinDim * cfg.simulation.local.ring2Ratio;
          },
          newCx,
          newCy
        ).strength(cfg.simulation.local.radialStrength));
      } else {
        simulation.force('center', d3.forceCenter(newCx, newCy));
        // Update activeRadial center if it exists
        if (activeNode) {
          simulation.force('activeRadial', d3.forceRadial<SimNode>(
            0, newCx, newCy
          ).strength((d) => d.path === activeNotePath ? cfg.simulation.global.activeRadialStrength : 0));
        }
      }
      simulation.alpha(cfg.simulation.resizeAlpha).restart();
    });
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    return () => {
      simulation.stop();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleMouseClick);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseDrag);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeObserver.disconnect();
    };
  }, [graphData, mode, activeNotePath, handleNodeClick, onNodeHover, recenterRef, starredPaths, canvasRef]);
}
