import createGraph from "ngraph.graph";
import createLayout from "ngraph.forcelayout";
import { GRAPH_CONFIG } from "../graphConfig";
import type { LayoutHandle, LayoutInput, NodePosition } from "./types";

export function createForceLayout(input: LayoutInput): LayoutHandle {
  const cfg = GRAPH_CONFIG.simulation.global;
  const graph = createGraph();

  // Build a defensive copy — ngraph stores node references internally and we
  // do not want to expose its mutation to consumers.
  for (const n of input.nodes) graph.addNode(n.id, { ...n });
  for (const e of input.edges) graph.addLink(e.fromNoteId, e.toNoteId);

  // ngraph convention: gravity NEGATIVE = repulsion, POSITIVE = attraction.
  // Our config uses d3-style chargeStrength (-400 = strong repulsion); divide
  // it down to ngraph's scale (~-12 default) and keep the sign so nodes
  // actually push apart instead of collapsing onto the centroid.
  const layout = createLayout(graph, {
    springLength: cfg.linkDistance,
    springCoefficient: 0.0008,
    gravity: cfg.chargeStrength / 30,
    theta: 0.8,
    dragCoefficient: 0.02,
    timeStep: 20,
  });

  const pinned = new Set<string>();

  // No active-pin: the simulation runs with every node free. The active
  // note is purely a *camera* concept — the GraphView render loop pans
  // the viewport to keep it on screen. Pinning the active produced
  // spider-web tugging when selection swapped the pin, because every
  // connected spring suddenly had a new fixed endpoint to react to.
  void input.activeId;

  // ngraph's gravity is pure repulsion; with no edges or sparse graphs the
  // cluster's centre of mass drifts. After every step we shift positions so
  // the *anchor* stays at (0, 0) — that's the active note when one is
  // selected (so the active stays dead-centre), or the centroid otherwise.
  // Keep the cluster centred on world (0, 0) so the camera has a stable
  // anchor regardless of which node is "active" (active is camera-only now).
  function recentre() {
    let sx = 0, sy = 0, count = 0;
    graph.forEachNode((node) => {
      const body = layout.getBody(node.id as string);
      if (!body) return;
      sx += body.pos.x; sy += body.pos.y; count++;
    });
    if (count === 0) return;
    const dx = sx / count, dy = sy / count;
    if (dx === 0 && dy === 0) return;
    graph.forEachNode((node) => {
      const id = node.id as string;
      const body = layout.getBody(id);
      if (!body || body.isPinned) return;
      body.pos.x -= dx;
      body.pos.y -= dy;
    });
  }

  // Soft anchor: nudge every node toward the origin proportional to its
  // distance. With pure repulsion, isolated/unconnected nodes drift outward
  // forever; this gives them a weak return spring so the cluster stays
  // compact without overpowering the link-driven layout.
  const ANCHOR_STRENGTH = 0.005;
  function applyAnchor() {
    graph.forEachNode((node) => {
      const id = node.id as string;
      const body = layout.getBody(id);
      if (!body || body.isPinned) return;
      body.velocity.x -= body.pos.x * ANCHOR_STRENGTH;
      body.velocity.y -= body.pos.y * ANCHOR_STRENGTH;
    });
  }

  const handle: LayoutHandle = {
    step() {
      applyAnchor();
      layout.step();
      recentre();
      for (const id of pinned) {
        const body = layout.getBody(id);
        if (!body) continue;
        body.velocity.x = 0;
        body.velocity.y = 0;
      }
    },
    getPosition(id) {
      const p = layout.getNodePosition(id);
      if (!p) return undefined;
      return { id, x: p.x, y: p.y };
    },
    *positions(): IterableIterator<NodePosition> {
      const out: NodePosition[] = [];
      graph.forEachNode((node) => {
        const id = node.id as string;
        const p = layout.getNodePosition(id);
        if (p) out.push({ id, x: p.x, y: p.y });
      });
      yield* out;
    },
    pin(id, x, y) {
      const body = layout.getBody(id);
      if (!body) return;
      body.pos.x = x;
      body.pos.y = y;
      body.isPinned = true;
      pinned.add(id);
    },
    unpin(id) {
      const body = layout.getBody(id);
      if (!body) return;
      body.isPinned = false;
      pinned.delete(id);
    },
    reheat(alpha) {
      graph.forEachNode((node) => {
        const body = layout.getBody(node.id as string);
        if (!body || body.isPinned) return;
        body.velocity.x += (Math.random() - 0.5) * alpha * 50;
        body.velocity.y += (Math.random() - 0.5) * alpha * 50;
      });
    },
    setActive() {
      // No-op for the force layout — active is purely a camera concept.
      // The render loop pans the viewport to follow the active note's
      // current position; the layout itself doesn't restructure.
    },
    setBounds() {
      // Force-directed global mode is bounds-agnostic; the camera handles
      // framing. No-op kept for interface uniformity with localLayout.
    },
    dispose() {
      pinned.clear();
      graph.clear();
    },
  };

  return handle;
}
