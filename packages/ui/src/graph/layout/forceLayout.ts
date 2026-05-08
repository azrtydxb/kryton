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

  const layout = createLayout(graph, {
    springLength: cfg.linkDistance,
    springCoefficient: 0.0008,
    gravity: cfg.chargeStrength * -1, // ngraph: positive gravity = repulsion
    theta: 0.8,
    dragCoefficient: 0.02,
    timeStep: 20,
  });

  const pinned = new Set<string>();

  const handle: LayoutHandle = {
    step() {
      layout.step();
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
