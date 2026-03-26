import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { database } from "../../../src/db";
import Note from "../../../src/db/models/Note";
import { colors, fontSize, spacing } from "../../../src/lib/theme";

interface GraphNode {
  id: string;
  label: string;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function parseWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) ?? [];
  return matches.map((m) => {
    const inner = m.slice(2, -2).split("|")[0].trim();
    return inner;
  });
}

function buildGraph(notes: Note[]): GraphData {
  const nodeMap = new Map<string, GraphNode>();

  // Add all notes as nodes (use path as id)
  for (const note of notes) {
    nodeMap.set(note.path, {
      id: note.path,
      label: note.title ?? note.path.split("/").pop() ?? note.path,
    });
  }

  const edges: GraphEdge[] = [];

  for (const note of notes) {
    const links = parseWikiLinks(note.content ?? "");
    for (const link of links) {
      // Try to find a note whose path ends with the link target
      const target = Array.from(nodeMap.keys()).find(
        (p) => p === link || p.endsWith(`/${link}`) || p.endsWith(`/${link}.md`)
      );
      if (target && target !== note.path) {
        edges.push({ source: note.path, target });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

function buildGraphHTML(graph: GraphData): string {
  const graphJson = JSON.stringify(graph);

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
  var graph = ${graphJson};
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', function() { resize(); draw(); });

  var nodes = graph.nodes.map(function(n) {
    return {
      id: n.id,
      label: n.label,
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0, vy: 0,
      radius: 6
    };
  });

  var edges = graph.edges.map(function(e) {
    return {
      source: nodes.find(function(n) { return n.id === e.source; }),
      target: nodes.find(function(n) { return n.id === e.target; })
    };
  }).filter(function(e) { return e.source && e.target; });

  var nodeIndex = {};
  nodes.forEach(function(n) { nodeIndex[n.id] = n; });

  var activeNode = null;
  var dragging = null;
  var dragOffX = 0, dragOffY = 0;

  // --- Force simulation ---
  var alpha = 1;
  var alphaDecay = 0.02;

  function tick() {
    if (alpha > 0.001) {
      alpha *= (1 - alphaDecay);

      // Repulsion
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = (1200 / (dist * dist)) * alpha;
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
        var force = (dist - 100) * 0.05 * alpha;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        e.source.vx += fx; e.source.vy += fy;
        e.target.vx -= fx; e.target.vy -= fy;
      });

      // Center gravity
      nodes.forEach(function(n) {
        n.vx += (W / 2 - n.x) * 0.005 * alpha;
        n.vy += (H / 2 - n.y) * 0.005 * alpha;
      });

      // Integrate
      nodes.forEach(function(n) {
        if (n === dragging) return;
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x += n.vx;
        n.y += n.vy;
        // Clamp
        n.x = Math.max(n.radius + 2, Math.min(W - n.radius - 2, n.x));
        n.y = Math.max(n.radius + 2, Math.min(H - n.radius - 2, n.y));
      });
    }
    draw();
    requestAnimationFrame(tick);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Edges
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.2;
    edges.forEach(function(e) {
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    });

    // Nodes
    nodes.forEach(function(n) {
      var isActive = n === activeNode;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + (isActive ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#7c3aed' : '#4b5563';
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = 'rgba(124,58,237,0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });

    // Labels (only show for active or if few nodes)
    var showLabels = nodes.length <= 30;
    nodes.forEach(function(n) {
      if (!showLabels && n !== activeNode) return;
      ctx.fillStyle = n === activeNode ? '#e2e8f0' : '#94a3b8';
      ctx.font = (n === activeNode ? 'bold ' : '') + '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + n.radius + 13);
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
      activeNode = n;
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
      var dx = e.changedTouches[0].clientX - (canvas.getBoundingClientRect().left + touchStartX - (canvas.getBoundingClientRect().left));
      // Simple tap detection: if dragging didn't move much
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

  requestAnimationFrame(tick);
})();
</script>
</body>
</html>`;
}

export default function GraphScreen() {
  const router = useRouter();
  const [graphHTML, setGraphHTML] = useState<string | null>(null);

  useEffect(() => {
    const col = database.get<Note>("notes");
    const subscription = col.query().observe().subscribe((notes) => {
      const graph = buildGraph(notes);
      setGraphHTML(buildGraphHTML(graph));
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "nodePress" && data.id) {
          const encoded = encodeURIComponent(data.id);
          router.push(`/(app)/note/${encoded}` as never);
        }
      } catch {
        // ignore
      }
    },
    [router]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Graph</Text>
      </View>

      {graphHTML === null ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Building graph…</Text>
        </View>
      ) : (
        <WebView
          source={{ html: graphHTML }}
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
    paddingTop: spacing.xl + spacing.md,
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
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
});
