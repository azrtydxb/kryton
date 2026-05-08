// packages/ui/src/graph/layout/localLayout.ts
import { GRAPH_CONFIG } from "../graphConfig";
import type { LayoutHandle, LayoutInput, NodePosition } from "./types";

interface InternalNode {
  id: string;
  hop: 0 | 1 | 2;
  /** Target ring radius in current bounds. */
  ringRadius: number;
  /** Angle around the active node, in radians. */
  angle: number;
  x: number;
  y: number;
  isPinned: boolean;
}

export function createLocalLayout(input: LayoutInput): LayoutHandle {
  const cfg = GRAPH_CONFIG.simulation.local;
  const adjacency = new Map<string, Set<string>>();
  for (const n of input.nodes) adjacency.set(n.id, new Set());
  for (const e of input.edges) {
    adjacency.get(e.fromNoteId)?.add(e.toNoteId);
    adjacency.get(e.toNoteId)?.add(e.fromNoteId);
  }

  function hopOf(id: string): 0 | 1 | 2 | -1 {
    if (id === input.activeId) return 0;
    const oneHop = adjacency.get(input.activeId ?? "") ?? new Set();
    if (oneHop.has(id)) return 1;
    for (const mid of oneHop) {
      if (adjacency.get(mid)?.has(id)) return 2;
    }
    return -1;
  }

  let cx = input.width / 2;
  let cy = input.height / 2;
  let minDim = Math.min(input.width, input.height);

  // Initial layout — group by hop, distribute evenly around the ring.
  const hopBuckets: [InternalNode[], InternalNode[], InternalNode[]] = [[], [], []];
  for (const n of input.nodes) {
    const rawHop = hopOf(n.id);
    if (rawHop < 0) continue;
    const hop = rawHop as 0 | 1 | 2;
    const ringRadius =
      hop === 0
        ? 0
        : hop === 1
          ? cfg.ring1Ratio * minDim
          : cfg.ring2Ratio * minDim;
    hopBuckets[hop].push({
      id: n.id,
      hop,
      ringRadius,
      angle: 0,
      x: cx,
      y: cy,
      isPinned: hop === 0,
    });
  }
  for (const bucket of hopBuckets) {
    const k = bucket.length;
    bucket.forEach((node, i) => {
      node.angle = (i / Math.max(k, 1)) * Math.PI * 2;
      node.x = cx + node.ringRadius * Math.cos(node.angle);
      node.y = cy + node.ringRadius * Math.sin(node.angle);
    });
  }
  const all: InternalNode[] = [...hopBuckets[0], ...hopBuckets[1], ...hopBuckets[2]];
  const byId = new Map(all.map((n) => [n.id, n]));
  const pinned = new Set<string>();
  if (input.activeId) pinned.add(input.activeId);

  function applyTangentialRelaxation() {
    // Per-ring repulsion: push nodes apart along their ring (tangential only).
    for (const ring of [1, 2] as const) {
      const bucket = hopBuckets[ring];
      if (!bucket || bucket.length < 2) continue;
      bucket.sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        const b = bucket[(i + 1) % bucket.length];
        if (!a || !b) continue;
        if (a.isPinned || b.isPinned) continue;
        let delta = b.angle - a.angle;
        if (delta < 0) delta += Math.PI * 2;
        const target = (Math.PI * 2) / bucket.length;
        const adjust = (target - delta) * cfg.radialStrength * 0.05;
        a.angle -= adjust * 0.5;
        b.angle += adjust * 0.5;
      }
    }
  }

  function project() {
    for (const n of all) {
      if (pinned.has(n.id)) continue;
      n.x = cx + n.ringRadius * Math.cos(n.angle);
      n.y = cy + n.ringRadius * Math.sin(n.angle);
    }
    const active = byId.get(input.activeId ?? "");
    if (active) {
      active.x = cx;
      active.y = cy;
    }
  }

  return {
    step() {
      applyTangentialRelaxation();
      project();
    },
    getPosition(id) {
      const n = byId.get(id);
      return n ? { id, x: n.x, y: n.y } : undefined;
    },
    *positions(): IterableIterator<NodePosition> {
      for (const n of all) yield { id: n.id, x: n.x, y: n.y };
    },
    pin(id, x, y) {
      const n = byId.get(id);
      if (!n) return;
      n.x = x;
      n.y = y;
      n.isPinned = true;
      pinned.add(id);
    },
    unpin(id) {
      const n = byId.get(id);
      if (!n) return;
      if (n.hop === 0) return; // active stays pinned
      n.isPinned = false;
      pinned.delete(id);
    },
    reheat() {
      // Local layout is analytic; reheat perturbs angles slightly.
      for (const n of all) {
        if (n.isPinned) continue;
        n.angle += (Math.random() - 0.5) * 0.2;
      }
    },
    setBounds(w, h) {
      cx = w / 2;
      cy = h / 2;
      minDim = Math.min(w, h);
      for (const n of all) {
        n.ringRadius =
          n.hop === 0
            ? 0
            : n.hop === 1
              ? cfg.ring1Ratio * minDim
              : cfg.ring2Ratio * minDim;
      }
    },
    dispose() {
      pinned.clear();
      byId.clear();
      hopBuckets.forEach((b) => (b.length = 0));
    },
  };
}
