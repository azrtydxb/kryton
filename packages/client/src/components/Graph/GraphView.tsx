import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import * as d3 from 'd3';
import { api, GraphData } from '../../lib/api';

interface GraphViewProps {
  onClose: () => void;
  onNoteSelect: (path: string) => void;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  path: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

export function GraphView({ onClose, onNoteSelect }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink>>();
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef(d3.zoomIdentity);

  useEffect(() => {
    api.getGraph()
      .then(data => { setGraphData(data); setLoading(false); })
      .catch(() => { setError('Failed to load graph'); setLoading(false); });
  }, []);

  const handleNodeClick = useCallback((node: SimNode) => {
    onNoteSelect(node.path);
    onClose();
  }, [onNoteSelect, onClose]);

  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains('dark');

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    };
    resize();

    const nodes: SimNode[] = graphData.nodes.map(n => ({ ...n }));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links: SimLink[] = graphData.edges
      .filter(e => nodeMap.has(e.fromNoteId) && nodeMap.has(e.toNoteId))
      .map(e => ({
        source: e.fromNoteId,
        target: e.toNoteId,
      }));

    nodesRef.current = nodes;
    linksRef.current = links;

    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
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
        if (source.x == null || source.y == null || target.x == null || target.y == null) continue;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const isHovered = hoveredNodeRef.current === node;
        const radius = isHovered ? 8 : 6;

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isHovered
          ? '#3b82f6'
          : isDark ? '#60a5fa' : '#3b82f6';
        ctx.fill();

        if (isHovered) {
          ctx.strokeStyle = isDark ? '#93c5fd' : '#2563eb';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label
        ctx.font = `${isHovered ? '12' : '11'}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDark ? '#e2e8f0' : '#334155';
        const label = node.title.length > 20 ? node.title.slice(0, 18) + '...' : node.title;
        ctx.fillText(label, node.x, node.y + radius + 4);
      }

      ctx.restore();
    }

    simulation.on('tick', draw);

    // Zoom + pan
    const d3Canvas = d3.select(canvas);
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });

    d3Canvas.call(zoom);

    // Hit-test helper
    function getNodeAt(mx: number, my: number): SimNode | null {
      const t = transformRef.current;
      const x = (mx - t.x) / t.k;
      const y = (my - t.y) / t.k;
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
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
      draw();
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
  }, [graphData, handleNodeClick]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-[90vw] h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h2 className="font-semibold text-sm">Knowledge Graph</h2>
            {graphData && (
              <span className="text-xs text-gray-500">
                {graphData.nodes.length} notes, {graphData.edges.length} connections
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Close graph">
            <X size={18} />
          </button>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">
              {error}
            </div>
          )}
          {graphData && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              No notes yet. Create some notes to see the graph.
            </div>
          )}
          <canvas ref={canvasRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
