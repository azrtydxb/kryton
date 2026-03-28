import React, { useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { getDatabase, NoteRow } from "../../../src/db";
import { colors, fontSize, spacing } from "../../../src/lib/theme";
import { activeNoteStore } from "../../../src/lib/activeNote";

interface GraphNode {
  id: string;
  label: string;
  starred?: boolean;
  shared?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewMode?: "local" | "full";
  hopDistances?: Record<string, number>;
}

function parseWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) ?? [];
  return matches.map((m) => {
    const inner = m.slice(2, -2).split("|")[0].trim();
    return inner;
  });
}

function computeHopDistances(
  sourceId: string,
  edges: GraphEdge[],
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
      if (edge.source === current) neighbor = edge.target;
      else if (edge.target === current) neighbor = edge.source;
      if (neighbor && !distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

function buildGraph(notes: NoteRow[], activeNotePath?: string | null): GraphData {
  const db = getDatabase();

  // Get starred paths
  const starredRow = db.getAllSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'starred' AND _status != 'deleted'"
  );
  let starredPaths = new Set<string>();
  if (starredRow.length > 0) {
    try {
      starredPaths = new Set(JSON.parse(starredRow[0].value));
    } catch {}
  }

  // Get shared note paths
  const sharedRows = db.getAllSync<{ path: string }>(
    "SELECT path FROM note_shares WHERE _status != 'deleted'"
  );
  const sharedPaths = new Set(sharedRows.map((r) => r.path));

  const nodeMap = new Map<string, GraphNode>();

  // Add all notes as nodes (use path as id)
  for (const note of notes) {
    nodeMap.set(note.path, {
      id: note.path,
      label: note.title ?? note.path.split("/").pop() ?? note.path,
      starred: starredPaths.has(note.path),
      shared: sharedPaths.has(note.path),
    });
  }

  // Build lookup maps for O(1) resolution
  const pathLookup = new Map<string, string>();
  for (const p of nodeMap.keys()) {
    const pLower = p.toLowerCase();
    pathLookup.set(pLower, p);
    const withoutMd = pLower.replace(/\.md$/, "");
    pathLookup.set(withoutMd, p);
    const basename = withoutMd.split("/").pop()!;
    if (!pathLookup.has(basename)) pathLookup.set(basename, p);
  }

  const edges: GraphEdge[] = [];

  for (const note of notes) {
    const links = parseWikiLinks(note.content ?? "");
    for (const link of links) {
      const linkLower = link.toLowerCase();
      const linkMdLower = linkLower.endsWith(".md")
        ? linkLower
        : `${linkLower}.md`;
      const target =
        pathLookup.get(linkMdLower) ??
        pathLookup.get(linkLower) ??
        pathLookup.get(linkLower.replace(/\.md$/, ""));
      if (target && target !== note.path) {
        edges.push({ source: note.path, target });
      }
    }
  }

  const viewMode: "local" | "full" = activeNotePath ? "local" : "full";
  const allNodes = Array.from(nodeMap.values());

  if (viewMode === "local" && activeNotePath) {
    const hopMap = computeHopDistances(activeNotePath, edges, 2);
    const visibleIds = new Set(hopMap.keys());
    const filteredNodes = allNodes
      .filter((n) => visibleIds.has(n.id))
      .map((n) => ({ ...n }));
    const filteredEdges = edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    );
    const hopDistances: Record<string, number> = {};
    hopMap.forEach((v, k) => {
      hopDistances[k] = v;
    });
    return { nodes: filteredNodes, edges: filteredEdges, viewMode, hopDistances };
  }

  return { nodes: allNodes, edges, viewMode };
}

function buildGraphHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    background: #0d1117;
    overflow: hidden;
  }
  canvas { display: block; }
  #tooltip {
    position: absolute;
    background: rgba(17,24,39,0.92);
    color: #e2e8f0;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
    pointer-events: none;
    display: none;
    border: 1px solid #374151;
    white-space: nowrap;
  }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="tooltip"></div>
<script>
(function() {
  var graph = { nodes: [], edges: [] };
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var W, H;
  var animFrameId = null;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', function() { resize(); draw(); });

  var nodes = [];
  var edges = [];
  var nodeIndex = {};
  var activeNode = null;
  var dragging = null;
  var dragOffX = 0, dragOffY = 0;
  var viewMode = 'full';
  var hopDistances = {};

  // --- Force simulation ---
  var alpha = 1;
  var alphaDecay = 0.02;

  function tick() {
    if (alpha > 0.001) {
      alpha *= (1 - alphaDecay);

      var linkDist = viewMode === 'local' ? 80 : 150;

      // Repulsion
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

      // Center gravity
      nodes.forEach(function(n) {
        n.vx += (W / 2 - n.x) * 0.003 * alpha;
        n.vy += (H / 2 - n.y) * 0.003 * alpha;
      });

      // Radial ring constraint for local mode
      if (viewMode === 'local' && activeNode) {
        var cx = W / 2, cy = H / 2;
        var ringSpacing = Math.min(W, H) * 0.18;
        nodes.forEach(function(n) {
          if (n === activeNode || n === dragging) return;
          var hop = n.hopDistance || 1;
          var targetR = hop * ringSpacing;
          var ndx = n.x - cx, ndy = n.y - cy;
          var currR = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
          var radialForce = (targetR - currR) * 0.06 * alpha;
          n.vx += (ndx / currR) * radialForce;
          n.vy += (ndy / currR) * radialForce;
        });
      }

      // Soft active node pull toward center in full mode
      if (viewMode === 'full' && activeNode && activeNode !== dragging) {
        activeNode.vx += (W / 2 - activeNode.x) * 0.1 * alpha;
        activeNode.vy += (H / 2 - activeNode.y) * 0.1 * alpha;
      }

      // Integrate
      nodes.forEach(function(n) {
        if (n === dragging) return;
        // Pin active node at center in local mode
        if (viewMode === 'local' && n.isActive) {
          n.x = W / 2;
          n.y = H / 2;
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x += n.vx;
        n.y += n.vy;
        // Clamp
        n.x = Math.max(n.radius + 2, Math.min(W - n.radius - 2, n.x));
        n.y = Math.max(n.radius + 2, Math.min(H - n.radius - 2, n.y));
      });
      draw();
      animFrameId = requestAnimationFrame(tick);
    } else {
      draw(); // final draw
      animFrameId = null;
    }
  }

  function reheat() {
    alpha = 1;
    if (!animFrameId) animFrameId = requestAnimationFrame(tick);
  }

  function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
    var rot = Math.PI / 2 * 3;
    var step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (var i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Edges
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 1.5;
    edges.forEach(function(e) {
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    });

    // Nodes
    nodes.forEach(function(n) {
      var r = n.radius || 6;

      if (n.starred) {
        drawStar(ctx, n.x, n.y, 5, r + 1, (r + 1) * 0.4);
        ctx.fillStyle = '#eab308';
        ctx.fill();
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        if (n.isActive) {
          ctx.fillStyle = '#25D366';
          ctx.fill();
          ctx.strokeStyle = '#128C7E';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (n.shared) {
          ctx.fillStyle = '#f97316';
          ctx.fill();
          ctx.strokeStyle = '#ea580c';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#a78bfa';
          ctx.fill();
        }
      }
    });

    // Labels — always shown, truncated to 20 chars
    nodes.forEach(function(n) {
      var lbl = n.label.length > 20 ? n.label.slice(0, 18) + '...' : n.label;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = (n === activeNode ? 'bold ' : '') + '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, n.x, n.y + n.radius + 13);
    });
  }

  // Touch interactions
  function getNodeAt(x, y) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) return n;
    }
    return null;
  }

  var touchStartX, touchStartY, touchStartTime;

  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    var t = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    var x = t.clientX - rect.left;
    var y = t.clientY - rect.top;
    touchStartX = x; touchStartY = y;
    touchStartTime = Date.now();
    var n = getNodeAt(x, y);
    if (n) {
      dragging = n;
      dragOffX = x - n.x;
      dragOffY = y - n.y;
      if (activeNode) { activeNode.isActive = false; activeNode.radius = activeNode.starred ? 7 : 6; }
      activeNode = n;
      n.isActive = true;
      n.radius = 10;
      reheat();
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (!dragging) return;
    var t = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    dragging.x = t.clientX - rect.left - dragOffX;
    dragging.y = t.clientY - rect.top - dragOffY;
    dragging.vx = 0; dragging.vy = 0;
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    e.preventDefault();
    var elapsed = Date.now() - touchStartTime;
    if (elapsed < 300 && dragging && activeNode) {
      var mdx = dragging.x - (touchStartX - dragOffX);
      var mdy = dragging.y - (touchStartY - dragOffY);
      if (Math.abs(mdx) < 10 && Math.abs(mdy) < 10) {
        // Tap on node — navigate
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'nodePress',
            id: activeNode.id
          }));
        }
      }
    }
    dragging = null;
  }, { passive: false });

  reheat();

  // Listen for graph data updates from React Native
  function initGraph(newGraph, activeNotePath) {
    graph = newGraph;
    viewMode = graph.viewMode || (activeNotePath ? 'local' : 'full');
    hopDistances = graph.hopDistances || {};
    nodes = graph.nodes.map(function(n) {
      var isActive = activeNotePath ? n.id === activeNotePath : false;
      var hopDist = hopDistances[n.id];
      var startX, startY;
      if (viewMode === 'local' && isActive) {
        startX = W / 2;
        startY = H / 2;
      } else {
        startX = W / 2 + (Math.random() - 0.5) * W * 0.6;
        startY = H / 2 + (Math.random() - 0.5) * H * 0.6;
      }
      return {
        id: n.id,
        label: n.label,
        starred: n.starred || false,
        shared: n.shared || false,
        isActive: isActive,
        hopDistance: hopDist !== undefined ? hopDist : -1,
        x: startX,
        y: startY,
        vx: 0, vy: 0,
        radius: n.starred ? 7 : 6
      };
    });
    edges = graph.edges.map(function(e) {
      return {
        source: nodes.find(function(n) { return n.id === e.source; }),
        target: nodes.find(function(n) { return n.id === e.target; })
      };
    }).filter(function(e) { return e.source && e.target; });
    nodeIndex = {};
    nodes.forEach(function(n) { nodeIndex[n.id] = n; });
    activeNode = activeNotePath ? (nodeIndex[activeNotePath] || null) : null;
    reheat();
  }

  function handleMessage(event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === 'updateGraph') {
        initGraph(msg.graph, msg.activeNotePath || null);
      }
    } catch(e) {}
  }

  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);

  // Signal ready to React Native
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  }
})();
</script>
</body>
</html>`;
}

const GRAPH_HTML = buildGraphHTML();

export default function GraphScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const isReadyRef = useRef(false);
  const pendingGraphRef = useRef<GraphData | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const activeNotePathRef = useRef<string | null>(activeNoteStore.get());

  // Subscribe to active note changes — rebuild graph to update viewMode and filtering
  useEffect(() => {
    const unsubscribe = activeNoteStore.subscribe((path) => {
      activeNotePathRef.current = path;
      if (isReadyRef.current && pendingGraphRef.current === null) {
        const db = getDatabase();
        const notes = db.getAllSync<NoteRow>("SELECT * FROM notes WHERE _status != 'deleted'");
        const g = buildGraph(notes, path);
        setGraph(g);
        webViewRef.current?.postMessage(
          JSON.stringify({ type: "updateGraph", graph: g, activeNotePath: path })
        );
      }
    });
    return unsubscribe;
  }, []);

  const loadGraph = useCallback(() => {
    const db = getDatabase();
    const notes = db.getAllSync<NoteRow>("SELECT * FROM notes WHERE _status != 'deleted'");
    const g = buildGraph(notes, activeNotePathRef.current);
    setGraph(g);
    if (isReadyRef.current) {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: "updateGraph", graph: g, activeNotePath: activeNotePathRef.current })
      );
    } else {
      pendingGraphRef.current = g;
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const handleWebViewReady = useCallback(() => {
    isReadyRef.current = true;
    if (pendingGraphRef.current) {
      webViewRef.current?.postMessage(
        JSON.stringify({
          type: "updateGraph",
          graph: pendingGraphRef.current,
          activeNotePath: activeNotePathRef.current,
        })
      );
      pendingGraphRef.current = null;
    }
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "ready") {
          handleWebViewReady();
        } else if (data.type === "nodePress" && data.id) {
          const encoded = encodeURIComponent(data.id);
          router.push(`/(app)/(tabs)/note/${encoded}` as never);
        }
      } catch {
        // ignore
      }
    },
    [router, handleWebViewReady]
  );

  const isEmpty = graph !== null && graph.nodes.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Graph</Text>
      </View>

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            Create notes with [[wiki-links]] to see your knowledge graph
          </Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ html: GRAPH_HTML }}
          style={styles.webview}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.text,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
