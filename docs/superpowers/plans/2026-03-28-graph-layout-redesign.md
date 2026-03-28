# Graph Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the graph visualization with tuned force-directed layout for global view, concentric ring layout for local view, full-screen overlay mode, and matching behavior on mobile.

**Architecture:** Update the D3 force simulation parameters and add `forceRadial` for local mode ring constraints. Add a full-screen overlay component to GraphPanel. Mirror all layout changes in the mobile WebView's inline JS force simulation.

**Tech Stack:** D3.js (forceRadial, forceSimulation), React, Canvas 2D, React Native WebView

---

### Task 1: Update graph config with new force parameters

**Files:**
- Modify: `packages/client/src/components/Graph/graphConfig.ts`

- [ ] **Step 1: Update the config with mode-specific parameters**

Replace the entire contents of `packages/client/src/components/Graph/graphConfig.ts`:

```typescript
export const GRAPH_CONFIG = {
  simulation: {
    // Global mode (tuned force-directed)
    global: {
      linkDistance: 150,
      chargeStrength: -400,
      collisionRadius: 40,
      activeRadialStrength: 0.1, // soft pull toward center
    },
    // Local mode (concentric rings)
    local: {
      linkDistance: 80,
      chargeStrength: -300,
      collisionRadius: 35,
      ring1Ratio: 0.3, // inner ring at 30% of min(width,height)
      ring2Ratio: 0.6, // outer ring at 60% of min(width,height)
      radialStrength: 0.8, // how tightly nodes stick to their ring
    },
    dragAlphaTarget: 0.3,
    resizeAlpha: 0.3,
    transitionAlpha: 0.5, // alpha reheat on mode switch
  },
  zoom: {
    scaleMin: 0.2,
    scaleMax: 5,
    recenterDuration: 300,
  },
  node: {
    activeRadius: 10,
    hoveredRadius: 8,
    defaultRadius: 6,
    starHoveredRadius: 9,
    starDefaultRadius: 7,
    starInnerRadiusRatio: 0.4,
    labelOffset: 4,
    hitTestRadiusSq: 100,
  },
  font: {
    activeSize: 12,
    defaultSize: 11,
    family: 'Inter, system-ui, sans-serif',
  },
  label: {
    maxLength: 20,
    truncatedLength: 18,
    ellipsis: '...',
  },
  colors: {
    light: {
      link: 'rgba(148, 163, 184, 0.4)',
      node: '#7c3aed',
      nodeHovered: '#7c3aed',
      nodeActive: '#25D366',
      nodeShared: '#f97316',
      strokeActive: '#128C7E',
      strokeShared: '#ea580c',
      strokeHovered: '#6d28d9',
      label: '#334155',
      star: '#eab308',
      starStroke: '#ca8a04',
    },
    dark: {
      link: 'rgba(100, 116, 139, 0.3)',
      node: '#a78bfa',
      nodeHovered: '#7c3aed',
      nodeActive: '#25D366',
      nodeShared: '#f97316',
      strokeActive: '#128C7E',
      strokeShared: '#ea580c',
      strokeHovered: '#c4b5fd',
      label: '#e2e8f0',
      star: '#eab308',
      starStroke: '#ca8a04',
    },
  },
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/components/Graph/graphConfig.ts
git commit -m "feat(graph): add mode-specific force parameters for global and local layouts"
```

---

### Task 2: Rewrite useD3Graph with radial layout for local mode and soft centering for global

**Files:**
- Modify: `packages/client/src/components/Graph/useD3Graph.ts`

- [ ] **Step 1: Rewrite useD3Graph.ts**

Replace the entire contents of `packages/client/src/components/Graph/useD3Graph.ts`. The key changes from the current version:

1. **Local mode**: Expand to 2-hop neighborhood. Use `d3.forceRadial` to constrain nodes to rings based on hop distance. Active node pinned at center.
2. **Global mode**: Remove `fx/fy` pinning. Add soft `forceRadial` pulling active node toward center (strength 0.1). Stronger charge and link distance.
3. **Mode transitions**: Reheat simulation with `transitionAlpha` for smooth animation.

```typescript
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

interface UseD3GraphOptions {
  activeNotePath: string | null;
  mode: 'local' | 'full';
  starredPaths?: Set<string>;
  onNodeClick: (path: string) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
}

/**
 * Compute hop distances from a source node using BFS.
 * Returns a Map of nodeId -> hop distance.
 */
function computeHopDistances(
  sourceId: string,
  edges: { fromNoteId: string; toNoteId: string }[],
  maxHops: number
): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(sourceId, 0);
  const queue = [sourceId];
  let idx = 0;

  while (idx < queue.length) {
    const current = queue[idx++];
    const currentDist = distances.get(current)!;
    if (currentDist >= maxHops) continue;

    for (const edge of edges) {
      let neighbor: string | null = null;
      if (edge.fromNoteId === current) neighbor = edge.toNoteId;
      else if (edge.toNoteId === current) neighbor = edge.fromNoteId;
      if (neighbor && !distances.has(neighbor)) {
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
  const { activeNotePath, mode, starredPaths, onNodeClick, recenterRef } = options;
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

    const nodes: SimNode[] = filteredNodes.map(n => {
      const activeNodeId = graphData.nodes.find(an => an.path === activeNotePath)?.id;
      return {
        ...n,
        hopDistance: hopDistances?.get(n.id) ?? undefined,
      };
    });
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

    // Build simulation based on mode
    const simulation = d3.forceSimulation(nodes);

    if (mode === 'local' && activeNotePath) {
      const localCfg = cfg.simulation.local;
      const activeNode = nodes.find(n => n.path === activeNotePath);

      // Pin active node at center
      if (activeNode) {
        activeNode.fx = cx;
        activeNode.fy = cy;
      }

      simulation
        .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(localCfg.linkDistance))
        .force('charge', d3.forceManyBody().strength(localCfg.chargeStrength))
        .force('collision', d3.forceCollide().radius(localCfg.collisionRadius))
        .force('radial', d3.forceRadial<SimNode>(
          (d) => {
            if (d.hopDistance === 0) return 0;
            if (d.hopDistance === 1) return minDim * localCfg.ring1Ratio;
            return minDim * localCfg.ring2Ratio;
          },
          cx,
          cy
        ).strength(localCfg.radialStrength));
    } else {
      // Global (full) mode
      const globalCfg = cfg.simulation.global;
      const activeNode = activeNotePath ? nodes.find(n => n.path === activeNotePath) : null;

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

    // Zoom + pan
    const d3Canvas = d3.select(canvas);
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([cfg.zoom.scaleMin, cfg.zoom.scaleMax])
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

    // Hit-test helper
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

    // Hover
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      hoveredNodeRef.current = node;
      canvas.style.cursor = node ? 'pointer' : 'default';
      draw();
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
        if (!(mode === 'local' && dragNode.path === activeNotePath)) {
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

      if (mode === 'local' && activeNotePath) {
        const activeNode = nodes.find(n => n.path === activeNotePath);
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
  }, [graphData, mode, activeNotePath, handleNodeClick, recenterRef, starredPaths, canvasRef]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Graph/useD3Graph.ts
git commit -m "feat(graph): add radial ring layout for local mode, soft centering for global mode"
```

---

### Task 3: Add full-screen overlay to GraphPanel

**Files:**
- Modify: `packages/client/src/components/Graph/GraphPanel.tsx`

- [ ] **Step 1: Rewrite GraphPanel with overlay support**

Replace the entire contents of `packages/client/src/components/Graph/GraphPanel.tsx`:

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';
import { Network, Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { GraphView } from './GraphView';
import { GraphData } from '../../lib/api';

interface GraphPanelProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
}

export function GraphPanel({ graphData, loading, activeNotePath, onNoteSelect, starredPaths }: GraphPanelProps) {
  const [mode, setMode] = useState<'local' | 'full'>('local');
  const [expanded, setExpanded] = useState(false);
  const recenterRef = useRef<(() => void) | null>(null);
  const expandedRecenterRef = useRef<(() => void) | null>(null);

  const effectiveMode = activeNotePath ? mode : 'full';

  // Close overlay on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded]);

  // When clicking a node in overlay, navigate and close
  const handleOverlayNoteSelect = useCallback((path: string) => {
    onNoteSelect(path);
    setExpanded(false);
  }, [onNoteSelect]);

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Graph</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => recenterRef.current?.()}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded transition-colors"
              aria-label="Center graph"
              title="Center graph"
            >
              <Crosshair size={13} />
            </button>
            <button
              onClick={() => setMode('local')}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                effectiveMode === 'local'
                  ? 'bg-violet-500/15 text-violet-500 font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Local
            </button>
            <button
              onClick={() => setMode('full')}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                effectiveMode === 'full'
                  ? 'bg-violet-500/15 text-violet-500 font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Full
            </button>
            <button
              onClick={() => setExpanded(true)}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded transition-colors"
              aria-label="Expand graph"
              title="Expand graph"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
        <GraphView
          graphData={graphData}
          loading={loading}
          activeNotePath={activeNotePath}
          mode={effectiveMode}
          onNoteSelect={onNoteSelect}
          recenterRef={recenterRef}
          starredPaths={starredPaths}
        />
      </div>

      {/* Full-screen overlay */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 bg-black/80 flex flex-col"
          style={{ zIndex: 99998 }}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-surface-900 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <Network size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-gray-200">Knowledge Graph</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => expandedRecenterRef.current?.()}
                className="p-1.5 text-gray-400 hover:text-gray-200 rounded transition-colors"
                aria-label="Center graph"
                title="Center graph"
              >
                <Crosshair size={16} />
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 text-gray-400 hover:text-gray-200 rounded transition-colors"
                aria-label="Close overlay"
                title="Close overlay"
              >
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1">
            <GraphView
              graphData={graphData}
              loading={loading}
              activeNotePath={activeNotePath}
              mode="full"
              onNoteSelect={handleOverlayNoteSelect}
              recenterRef={expandedRecenterRef}
              starredPaths={starredPaths}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Graph/GraphPanel.tsx
git commit -m "feat(graph): add full-screen graph overlay with expand/shrink buttons"
```

---

### Task 4: Update mobile graph with matching layout logic

**Files:**
- Modify: `packages/mobile/app/(app)/(tabs)/graph.tsx`

- [ ] **Step 1: Read the current mobile graph file**

Read `packages/mobile/app/(app)/(tabs)/graph.tsx` in full to understand the current inline JS force simulation, node rendering, and touch interaction code.

- [ ] **Step 2: Update the inline JS force simulation**

In the `buildGraphHTML()` function's `<script>` section, update the force simulation to match the web client:

**Changes to the `tick()` function:**

1. **Repulsion force**: Change from `1200 / (dist * dist)` to `2400 / (dist * dist)` (stronger, matching -400 charge)
2. **Link attraction**: Change link distance from `100` to `150` for global mode, `80` for local mode
3. **Center gravity**: Change from `0.005` to `0.003` (softer, let nodes spread)
4. **Add radial ring constraint for local mode**: When `viewMode === 'local'`, apply radial force pushing nodes toward their ring based on hop distance
5. **Soft active node centering in global mode**: Instead of pinning, add gentle pull toward center

The mobile graph receives `viewMode` and `hopDistances` via `postMessage` from the React Native side. The `setGraph` handler already receives graph data — extend it to also accept hop distance information.

**Changes to `setGraph()`:**
- Accept a `hopDistances` map in the data
- Store it on each node as `n.hopDistance`

**Changes to the force simulation in `tick()`:**

Replace the existing `tick()` function body (forces section only, keep integration and clamping):

```javascript
// In tick(), replace the forces section:

// Repulsion (stronger)
for (var i = 0; i < nodes.length; i++) {
  for (var j = i + 1; j < nodes.length; j++) {
    var a = nodes[i], b = nodes[j];
    var dx = b.x - a.x, dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var force = (2400 / (dist * dist)) * alpha;
    var fx = (dx / dist) * force;
    var fy = (dy / dist) * force;
    a.vx -= fx; a.vy -= fy;
    b.vx += fx; b.vy += fy;
  }
}

// Attraction along edges
var linkDist = viewMode === 'local' ? 80 : 150;
edges.forEach(function(e) {
  var dx = e.target.x - e.source.x;
  var dy = e.target.y - e.source.y;
  var dist = Math.sqrt(dx * dx + dy * dy) || 1;
  var force = (dist - linkDist) * 0.05 * alpha;
  var fx = (dx / dist) * force;
  var fy = (dy / dist) * force;
  e.source.vx += fx; e.source.vy += fy;
  e.target.vx -= fx; e.target.vy -= fy;
});

// Center gravity (softer)
nodes.forEach(function(n) {
  n.vx += (W / 2 - n.x) * 0.003 * alpha;
  n.vy += (H / 2 - n.y) * 0.003 * alpha;
});

// Radial ring constraint (local mode)
if (viewMode === 'local') {
  var minDim = Math.min(W, H);
  nodes.forEach(function(n) {
    if (n.hopDistance === 0) return; // active node stays pinned
    var targetR = n.hopDistance === 1 ? minDim * 0.3 : minDim * 0.6;
    var dx = n.x - W / 2;
    var dy = n.y - H / 2;
    var currentR = Math.sqrt(dx * dx + dy * dy) || 1;
    var strength = 0.8 * alpha;
    var ratio = (targetR - currentR) / currentR * strength;
    n.vx += dx * ratio;
    n.vy += dy * ratio;
  });
}

// Soft active node pull in global mode
if (viewMode === 'full' && activeNode) {
  activeNode.vx += (W / 2 - activeNode.x) * 0.1 * alpha;
  activeNode.vy += (H / 2 - activeNode.y) * 0.1 * alpha;
}
```

Also update the `setGraph` handler to compute and store hop distances on each node, and update the `buildGraph` function in the React Native side to pass `viewMode` and compute hop distances via BFS.

- [ ] **Step 3: Update buildGraph() in React Native to compute hop distances**

In the React Native component code (above `buildGraphHTML()`), update the `buildGraph()` function and the WebView message handler to pass hop distances and view mode to the WebView.

- [ ] **Step 4: Verify the mobile app TypeScript compiles**

```bash
cd packages/mobile && npx tsc --noEmit 2>&1 | grep graph
```

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/app/\(app\)/\(tabs\)/graph.tsx
git commit -m "feat(mobile): match graph layout to web — radial rings for local, tuned forces for global"
```

---

### Task 5: Bump version

**Files:**
- Modify: `package.json`, `packages/client/package.json`, `packages/server/package.json`, `packages/mobile/package.json`, `packages/mobile/app.json`

- [ ] **Step 1: Bump all versions to v4.3.0**

This is a new feature (Y bump per versioning scheme). Update `"version": "4.2.2"` to `"version": "4.3.0"` in all five files.

- [ ] **Step 2: Commit**

```bash
git add package.json packages/*/package.json packages/mobile/app.json
git commit -m "chore: bump all packages to v4.3.0"
```
