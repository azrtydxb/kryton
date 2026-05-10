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

  // Mutable active id — `setActive(...)` updates this without recreating the
  // layout, so existing positions survive the swap and the cluster morphs
  // smoothly around the new pin.
  let activeId: string | null = input.activeId ?? null;

  // Pin the active note at the origin so every layout pass orbits around it.
  // The pinned node never moves; everything else relaxes around it under
  // spring + repulsion + the soft anchor below.
  if (activeId) {
    const body = layout.getBody(activeId);
    if (body) {
      body.pos.x = 0;
      body.pos.y = 0;
      body.isPinned = true;
      pinned.add(activeId);
    }
  }

  // ngraph's gravity is pure repulsion; with no edges or sparse graphs the
  // cluster's centre of mass drifts. After every step we shift positions so
  // the *anchor* stays at (0, 0) — that's the active note when one is
  // selected (so the active stays dead-centre), or the centroid otherwise.
  // Recentre keeps the cluster centred on world (0, 0) when there's NO active
  // note. With an active note the camera (in GraphView) tracks the active's
  // world position instead — shifting positions here would teleport every
  // body each frame, defeating the morph.
  function recentre() {
    if (activeId) return;
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
    setActive(id) {
      // Release the previous pin (if any) so its body becomes a free
      // particle again — spring + repulsion will push it away from the
      // new focus naturally as the cluster reorganises.
      if (activeId) {
        const prev = layout.getBody(activeId);
        if (prev) prev.isPinned = false;
        pinned.delete(activeId);
      }
      activeId = id;
      if (!id) return;
      // Pin the new active *where it currently sits* — no teleport. The
      // camera (in GraphView) follows the active's world position each
      // frame, so as connected nodes pull closer (springs) and unrelated
      // ones drift away (repulsion), the user sees the existing graph
      // morph and the camera glide to the new focus, instead of a fresh
      // layout snap.
      const body = layout.getBody(id);
      if (!body) return;
      body.isPinned = true;
      body.velocity.x = 0;
      body.velocity.y = 0;
      pinned.add(id);
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
