import { useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import * as d3 from 'd3';
import { GraphData } from '../../lib/api';

interface GraphViewProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  mode: 'local' | 'full';
  onNoteSelect: (path: string) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
  starredPaths?: Set<string>;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  path: string;
  shared?: boolean;
  ownerUserId?: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

export function GraphView({ graphData, loading, activeNotePath, mode, onNoteSelect, recenterRef, starredPaths }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink>>(undefined);
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);

  const handleNodeClick = useCallback((node: SimNode) => {
    if (node.shared && node.ownerUserId) {
      onNoteSelect(`shared:${node.ownerUserId}:${node.path}`);
    } else {
      onNoteSelect(node.path);
    }
  }, [onNoteSelect]);

  // Simulation setup
  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Filter for local mode
    let filteredNodes = graphData.nodes;
    let filteredEdges = graphData.edges;

    if (mode === 'local' && activeNotePath) {
      const activeNodeId = graphData.nodes.find(n => n.path === activeNotePath)?.id;
      if (activeNodeId) {
        const connectedIds = new Set<string>();
        connectedIds.add(activeNodeId);
        for (const edge of graphData.edges) {
          if (edge.fromNoteId === activeNodeId) connectedIds.add(edge.toNoteId);
          if (edge.toNoteId === activeNodeId) connectedIds.add(edge.fromNoteId);
        }
        filteredNodes = graphData.nodes.filter(n => connectedIds.has(n.id));
        filteredEdges = graphData.edges.filter(e => connectedIds.has(e.fromNoteId) && connectedIds.has(e.toNoteId));
      }
    }

    const isDark = document.documentElement.classList.contains('dark');

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

    const nodes: SimNode[] = filteredNodes.map(n => ({ ...n }));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links: SimLink[] = filteredEdges
      .filter(e => nodeMap.has(e.fromNoteId) && nodeMap.has(e.toNoteId))
      .map(e => ({
        source: e.fromNoteId,
        target: e.toNoteId,
      }));

    nodesRef.current = nodes;
    linksRef.current = links;

    // Pin active node at center so others orbit around it
    const activeNode = activeNotePath ? nodes.find(n => n.path === activeNotePath) : null;
    if (activeNode) {
      activeNode.fx = currentWidth / 2;
      activeNode.fy = currentHeight / 2;
    }

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(currentWidth / 2, currentHeight / 2))
      .force('collision', d3.forceCollide().radius(30));

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
      ctx.strokeStyle = isDark ? 'rgba(100, 116, 139, 0.3)' : 'rgba(148, 163, 184, 0.4)';
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
        const radius = isActive ? 10 : isHovered ? 8 : 6;

        if (isStarred && !isActive) {
          // Draw star shape for starred nodes
          const r = isHovered ? 9 : 7;
          const innerR = r * 0.4;
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
          ctx.fillStyle = '#eab308';
          ctx.fill();
          ctx.strokeStyle = '#ca8a04';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          // Normal circle node
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isActive
            ? '#25D366'
            : isShared
              ? '#f97316'
              : isHovered
                ? '#7c3aed'
                : isDark ? '#a78bfa' : '#7c3aed';
          ctx.fill();

          if (isHovered || isActive || isShared) {
            ctx.strokeStyle = isActive
              ? '#128C7E'
              : isShared
                ? '#ea580c'
                : isDark ? '#c4b5fd' : '#6d28d9';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        // Label
        ctx.font = `${isHovered || isActive ? '12' : '11'}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDark ? '#e2e8f0' : '#334155';
        const label = node.title.length > 20 ? node.title.slice(0, 18) + '...' : node.title;
        ctx.fillText(label, node.x, node.y + radius + 4);
      }

      ctx.restore();
    }

    simulation.on('tick', draw);

    // Reset zoom to identity so the pinned center node is visible
    transformRef.current = d3.zoomIdentity;

    // Zoom + pan
    const d3Canvas = d3.select(canvas);
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 5])
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
        d3Canvas.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
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
        if (dx * dx + dy * dy < 100) return node;
      }
      return null;
    }

    // Hover detection
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      hoveredNodeRef.current = node;
      canvas.style.cursor = node ? 'pointer' : 'default';
      draw();
    };

    // Click detection
    const handleMouseClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) handleNodeClick(node);
    };

    // Drag behavior
    let dragNode: SimNode | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        dragNode = node;
        simulation.alphaTarget(0.3).restart();
        // Prevent zoom while dragging
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
        dragNode.fx = null;
        dragNode.fy = null;
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
      // Re-center active node and simulation after resize
      if (activeNode) {
        activeNode.fx = currentWidth / 2;
        activeNode.fy = currentHeight / 2;
      }
      simulation.force('center', d3.forceCenter(currentWidth / 2, currentHeight / 2));
      simulation.alpha(0.3).restart();
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
  }, [graphData, mode, activeNotePath, handleNodeClick, recenterRef, starredPaths]);

  return (
    <div className="flex-1 relative overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-violet-500" />
        </div>
      )}
      {graphData && graphData.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
          No notes yet
        </div>
      )}
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
