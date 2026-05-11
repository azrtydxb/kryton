# Graph Cross-Platform Renderer — Implementation Plan

**Status**: Implemented. The `layout/`, `view/`, and `gestures/` layers all ship in `packages/ui/src/graph/`. Web build resolves `CanvasPainter.web` + `useViewport.web`; React Native build resolves `SkiaPainter.native` + `useViewport.native`. Shared `drawScene.ts` + `hitTest.ts` drive both. React-Native deps (`@shopify/react-native-skia`, `react-native-gesture-handler`, `react-native-reanimated`) declared as optional peer deps so web installs stay lean.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the d3+canvas graph renderer with a layout/painter/gestures architecture that runs natively on web (canvas2d), Tauri (web build), and React Native (Skia native), with zero d3 and zero WebView shims.

**Architecture:** Three independent layers in `packages/ui/src/graph/` — `layout/` (pure-JS `ngraph.forcelayout` wrapper + analytic ring layout), `view/` (a `Painter` interface with `CanvasPainter` for web/Tauri and `SkiaPainter` for RN, sharing a single `drawScene` function), and `gestures/` (hand-rolled pinch/pan/tap, pointer events on web + `react-native-gesture-handler` on RN).

**Tech Stack:** TypeScript, React, vitest, `ngraph.forcelayout`, `ngraph.graph`, `@shopify/react-native-skia` (RN only), `react-native-gesture-handler` (RN only), `react-native-reanimated` (RN only).

**Spec:** [`docs/superpowers/specs/2026-05-08-graph-cross-platform-renderer.md`](../specs/2026-05-08-graph-cross-platform-renderer.md)

---

## File ownership

This is a single-stream task (no parallelism within the plan; the new files have a strict dependency chain). Files owned:

- `packages/ui/src/graph/layout/**` (new)
- `packages/ui/src/graph/view/**` (new)
- `packages/ui/src/graph/gestures/**` (new)
- `packages/ui/src/graph/index.ts` (modify)
- `packages/ui/src/graph/useD3Graph.ts` (delete after T-19)
- `packages/ui/src/graph/GraphView.tsx` (delete after T-19)
- `packages/ui/src/graph/__tests__/graph.test.tsx` (replace)
- `packages/ui/package.json` (modify deps)
- `packages/client/package.json` (modify deps)
- `packages/client/vite.config.*` (modify if `.web.tsx` resolution needs config)

Not touched: `packages/ui/src/graph/graphConfig.ts` (unchanged), any consumer code that imports `<GraphView>` from `@azrtydxb/ui` (prop surface is preserved).

---

## Task T-1: Verify build-config resolves platform extensions

**Files:**
- Inspect: `packages/client/vite.config.ts` (or equivalent)
- Inspect: `packages/ui/tsconfig.json`

- [ ] **Step 1: Confirm Vite resolves `.web.tsx` automatically for the client build**

Run: `grep -rn "extensions" packages/client/vite.config.* packages/ui/tsconfig.json`

Expected: either an explicit `resolve.extensions` array including `.web.tsx`, or the absence (Vite defaults include `.web.tsx` only if configured). If absent, add to `packages/client/vite.config.ts`:

```ts
export default defineConfig({
  // ...existing
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
});
```

- [ ] **Step 2: Add a one-file smoke test**

Create `packages/ui/src/graph/__tests__/_platform-resolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PLATFORM_TAG } from "../_platform-probe";

describe("platform extension resolution", () => {
  it("resolves the .web.ts variant under vitest (jsdom)", () => {
    expect(PLATFORM_TAG).toBe("web");
  });
});
```

Create `packages/ui/src/graph/_platform-probe.ts`:

```ts
export const PLATFORM_TAG = "native";
```

Create `packages/ui/src/graph/_platform-probe.web.ts`:

```ts
export const PLATFORM_TAG = "web";
```

- [ ] **Step 3: Run the test**

Run: `cd packages/ui && npm test -- _platform-resolution`
Expected: PASS — `PLATFORM_TAG` is `"web"`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/graph/_platform-probe*.ts packages/ui/src/graph/__tests__/_platform-resolution.test.ts packages/client/vite.config.ts
git commit -m "build: verify .web.tsx platform-extension resolution for graph subsystem"
```

---

## Task T-2: Add ngraph dependencies, drop d3 from `@azrtydxb/ui`

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Edit package.json**

In `packages/ui/package.json`, remove from `dependencies`:
- `"d3": "^7.9.0"`
- `"@types/d3": "^7.4.3"`

Add to `dependencies`:
- `"ngraph.forcelayout": "^3.3.1"`
- `"ngraph.graph": "^20.0.1"`

Add to `peerDependencies`:
- `"@shopify/react-native-skia": ">=1.5.0"`
- `"react-native-gesture-handler": ">=2.18.0"`
- `"react-native-reanimated": ">=3.15.0"`

Add to `peerDependenciesMeta` (mark RN peers optional so web consumers don't need them):

```json
"peerDependenciesMeta": {
  "@shopify/react-native-skia": { "optional": true },
  "react-native-gesture-handler": { "optional": true },
  "react-native-reanimated": { "optional": true }
}
```

- [ ] **Step 2: Install**

Run: `cd packages/ui && npm install`
Expected: install succeeds; no `d3` in `node_modules/.package-lock.json` for ui.

- [ ] **Step 3: Confirm d3 is gone from the ui dep tree**

Run: `cd packages/ui && npm ls d3`
Expected: `(empty)` or `not in dependency tree`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json package-lock.json
git commit -m "deps(ui): replace d3 with ngraph.forcelayout, declare RN graph peers"
```

---

## Task T-3: Layout types

**Files:**
- Create: `packages/ui/src/graph/layout/types.ts`

- [ ] **Step 1: Write the types**

```ts
import type { GraphNode, GraphEdge } from "../types";

export type LayoutMode = "global" | "local";

export interface LayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: LayoutMode;
  activeId: string | null;
  width: number;
  height: number;
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

/**
 * Renderer-agnostic handle to a running layout. Drives one tick at a time;
 * the caller (web raf loop or RN useFrameCallback) decides cadence.
 */
export interface LayoutHandle {
  /** Advance the simulation by one tick. Cheap; safe to call every frame. */
  step(): void;
  /** Current position of a node, or undefined if the id is unknown. */
  getPosition(id: string): NodePosition | undefined;
  /** Iterate all current positions. */
  positions(): IterableIterator<NodePosition>;
  /** Pin a node to (x, y); subsequent steps treat it as fixed. */
  pin(id: string, x: number, y: number): void;
  /** Release a previously-pinned node. */
  unpin(id: string): void;
  /** Inject kinetic energy after a structural change. */
  reheat(alpha: number): void;
  /** Update viewport bounds; the layout may rescale ring radii etc. */
  setBounds(width: number, height: number): void;
  /** Tear down internal state, free references. */
  dispose(): void;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/graph/layout/types.ts
git commit -m "feat(graph): add LayoutHandle types"
```

---

## Task T-4: Force layout (global mode) — TDD

**Files:**
- Create: `packages/ui/src/graph/layout/forceLayout.ts`
- Create: `packages/ui/src/graph/layout/__tests__/forceLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/graph/layout/__tests__/forceLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createForceLayout } from "../forceLayout";
import type { LayoutInput } from "../types";

const input: LayoutInput = {
  nodes: [
    { id: "a", title: "A", path: "a.md" },
    { id: "b", title: "B", path: "b.md" },
    { id: "c", title: "C", path: "c.md" },
  ],
  edges: [
    { fromNoteId: "a", toNoteId: "b" },
    { fromNoteId: "b", toNoteId: "c" },
  ],
  mode: "global",
  activeId: null,
  width: 400,
  height: 400,
};

describe("createForceLayout", () => {
  it("returns finite positions after one step", () => {
    const layout = createForceLayout(input);
    layout.step();
    for (const p of layout.positions()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    layout.dispose();
  });

  it("converges (max delta shrinks across iterations)", () => {
    const layout = createForceLayout(input);
    const snapshot = () =>
      [...layout.positions()].map((p) => ({ id: p.id, x: p.x, y: p.y }));
    for (let i = 0; i < 50; i++) layout.step();
    const before = snapshot();
    for (let i = 0; i < 50; i++) layout.step();
    const after = snapshot();
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) {
      const dx = before[i].x - after[i].x;
      const dy = before[i].y - after[i].y;
      maxDelta = Math.max(maxDelta, Math.hypot(dx, dy));
    }
    // After 100 total steps, displacement per 50-step window should be tiny.
    expect(maxDelta).toBeLessThan(20);
    layout.dispose();
  });

  it("pin holds a node fixed across steps", () => {
    const layout = createForceLayout(input);
    layout.pin("a", 10, 20);
    for (let i = 0; i < 20; i++) layout.step();
    const pos = layout.getPosition("a");
    expect(pos?.x).toBe(10);
    expect(pos?.y).toBe(20);
    layout.dispose();
  });

  it("unpin allows the node to move again", () => {
    const layout = createForceLayout(input);
    layout.pin("a", 0, 0);
    for (let i = 0; i < 5; i++) layout.step();
    layout.unpin("a");
    for (let i = 0; i < 50; i++) layout.step();
    const pos = layout.getPosition("a");
    // After unpin and 50 ticks, the node should have moved off (0,0).
    expect(Math.hypot(pos!.x, pos!.y)).toBeGreaterThan(0.1);
    layout.dispose();
  });

  it("reheat increases per-tick movement", () => {
    const layout = createForceLayout(input);
    for (let i = 0; i < 200; i++) layout.step();
    const settledPositions = [...layout.positions()];
    layout.reheat(0.5);
    layout.step();
    let total = 0;
    for (const p of layout.positions()) {
      const prev = settledPositions.find((s) => s.id === p.id)!;
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
    }
    expect(total).toBeGreaterThan(0);
    layout.dispose();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/ui && npm test -- forceLayout`
Expected: FAIL — `createForceLayout is not a function` (module missing).

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/graph/layout/forceLayout.ts`:

```ts
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
      // Re-apply pins (ngraph step may move pinned nodes slightly through
      // accumulated body forces; our pin contract is hard).
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
      graph.forEachNode((node) => {
        const p = layout.getNodePosition(node.id as string);
        if (!p) return;
        // generators inside callbacks: collect first
      });
      // ngraph's forEachNode is sync; collect into an array and yield.
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
      // ngraph has no alpha; emulate by perturbing velocities.
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/ui && npm test -- forceLayout`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/layout/forceLayout.ts packages/ui/src/graph/layout/__tests__/forceLayout.test.ts
git commit -m "feat(graph): force layout via ngraph.forcelayout, with tests"
```

---

## Task T-5: Local layout (concentric rings) — TDD

**Files:**
- Create: `packages/ui/src/graph/layout/localLayout.ts`
- Create: `packages/ui/src/graph/layout/__tests__/localLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createLocalLayout } from "../localLayout";
import type { LayoutInput } from "../types";

const input: LayoutInput = {
  nodes: [
    { id: "active", title: "Active", path: "a.md" },
    { id: "n1", title: "N1", path: "n1.md" }, // 1-hop
    { id: "n2", title: "N2", path: "n2.md" }, // 1-hop
    { id: "n3", title: "N3", path: "n3.md" }, // 2-hop (via n1)
    { id: "n4", title: "N4", path: "n4.md" }, // 2-hop (via n2)
  ],
  edges: [
    { fromNoteId: "active", toNoteId: "n1" },
    { fromNoteId: "active", toNoteId: "n2" },
    { fromNoteId: "n1", toNoteId: "n3" },
    { fromNoteId: "n2", toNoteId: "n4" },
  ],
  mode: "local",
  activeId: "active",
  width: 400,
  height: 400,
};

describe("createLocalLayout", () => {
  it("pins active at center", () => {
    const layout = createLocalLayout(input);
    layout.step();
    const pos = layout.getPosition("active");
    expect(pos?.x).toBeCloseTo(200, 0);
    expect(pos?.y).toBeCloseTo(200, 0);
    layout.dispose();
  });

  it("places 1-hop nodes on inner ring (~30% of min dimension)", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 30; i++) layout.step();
    const r1 = 0.3 * 400;
    for (const id of ["n1", "n2"]) {
      const p = layout.getPosition(id)!;
      const dist = Math.hypot(p.x - 200, p.y - 200);
      expect(Math.abs(dist - r1)).toBeLessThan(5);
    }
    layout.dispose();
  });

  it("places 2-hop nodes on outer ring (~55% of min dimension)", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 30; i++) layout.step();
    const r2 = 0.55 * 400;
    for (const id of ["n3", "n4"]) {
      const p = layout.getPosition(id)!;
      const dist = Math.hypot(p.x - 200, p.y - 200);
      expect(Math.abs(dist - r2)).toBeLessThan(5);
    }
    layout.dispose();
  });

  it("setBounds rescales ring radii", () => {
    const layout = createLocalLayout(input);
    for (let i = 0; i < 20; i++) layout.step();
    layout.setBounds(800, 800);
    for (let i = 0; i < 20; i++) layout.step();
    const r1 = 0.3 * 800;
    const p = layout.getPosition("n1")!;
    const dist = Math.hypot(p.x - 400, p.y - 400);
    expect(Math.abs(dist - r1)).toBeLessThan(10);
    layout.dispose();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/ui && npm test -- localLayout`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
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
  const hopBuckets: InternalNode[][] = [[], [], []];
  for (const n of input.nodes) {
    const hop = hopOf(n.id);
    if (hop < 0) continue;
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
      if (bucket.length < 2) continue;
      bucket.sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        const b = bucket[(i + 1) % bucket.length];
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/ui && npm test -- localLayout`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/layout/localLayout.ts packages/ui/src/graph/layout/__tests__/localLayout.test.ts
git commit -m "feat(graph): analytic concentric-ring local layout, with tests"
```

---

## Task T-6: Layout barrel + factory

**Files:**
- Create: `packages/ui/src/graph/layout/index.ts`

- [ ] **Step 1: Write the barrel + dispatcher**

```ts
import type { LayoutHandle, LayoutInput } from "./types";
import { createForceLayout } from "./forceLayout";
import { createLocalLayout } from "./localLayout";

export type { LayoutHandle, LayoutInput, LayoutMode, NodePosition } from "./types";
export { createForceLayout } from "./forceLayout";
export { createLocalLayout } from "./localLayout";

export function createLayout(input: LayoutInput): LayoutHandle {
  return input.mode === "local" ? createLocalLayout(input) : createForceLayout(input);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/graph/layout/index.ts
git commit -m "feat(graph): layout barrel with mode dispatcher"
```

---

## Task T-7: Painter interface + Scene type

**Files:**
- Create: `packages/ui/src/graph/view/Painter.ts`

- [ ] **Step 1: Write the interface**

```ts
import type { GraphNode } from "../types";
import type { NodePosition } from "../layout/types";

export interface ScenePainterStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  alpha?: number;
}

/**
 * Renderer-agnostic 2D painter. Both CanvasPainter (web/Tauri) and
 * SkiaPainter (RN) implement this surface. drawScene() is the only
 * caller — keep it minimal.
 */
export interface Painter {
  beginFrame(width: number, height: number): void;
  endFrame(): void;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(s: number): void;

  drawCircle(x: number, y: number, r: number, style: ScenePainterStyle): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, style: ScenePainterStyle): void;
  drawStar(x: number, y: number, outerR: number, innerR: number, points: number, style: ScenePainterStyle): void;
  drawText(x: number, y: number, text: string, fontSize: number, fontFamily: string, color: string, align?: "left" | "center" | "right"): void;
  measureText(text: string, fontSize: number, fontFamily: string): number;
}

export interface SceneNode {
  node: GraphNode;
  position: NodePosition;
  isActive: boolean;
  isHovered: boolean;
  isStarred: boolean;
  isShared: boolean;
  isVisible: boolean;
  isInLocalSet: boolean;
}

export interface SceneEdge {
  fromPosition: NodePosition;
  toPosition: NodePosition;
  isActive: boolean;
  isHovered: boolean;
  isInLocalSet: boolean;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Viewport transform. */
  transform: { x: number; y: number; k: number };
  /** "light" or "dark" — selects the palette in graphConfig.colors. */
  theme: "light" | "dark";
  /** Mode-aware: local mode ghosts non-set elements. */
  mode: "global" | "local";
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/graph/view/Painter.ts
git commit -m "feat(graph): Painter interface and Scene types"
```

---

## Task T-8: Fake painter (for tests)

**Files:**
- Create: `packages/ui/src/graph/view/__tests__/fakePainter.ts`

- [ ] **Step 1: Write the recorder**

```ts
import type { Painter, ScenePainterStyle } from "../Painter";

export type DrawCall =
  | { kind: "beginFrame"; w: number; h: number }
  | { kind: "endFrame" }
  | { kind: "save" }
  | { kind: "restore" }
  | { kind: "translate"; x: number; y: number }
  | { kind: "scale"; s: number }
  | { kind: "circle"; x: number; y: number; r: number; style: ScenePainterStyle }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; style: ScenePainterStyle }
  | { kind: "star"; x: number; y: number; outerR: number; innerR: number; points: number; style: ScenePainterStyle }
  | { kind: "text"; x: number; y: number; text: string };

export function createFakePainter(): { painter: Painter; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const painter: Painter = {
    beginFrame: (w, h) => calls.push({ kind: "beginFrame", w, h }),
    endFrame: () => calls.push({ kind: "endFrame" }),
    save: () => calls.push({ kind: "save" }),
    restore: () => calls.push({ kind: "restore" }),
    translate: (x, y) => calls.push({ kind: "translate", x, y }),
    scale: (s) => calls.push({ kind: "scale", s }),
    drawCircle: (x, y, r, style) => calls.push({ kind: "circle", x, y, r, style }),
    drawLine: (x1, y1, x2, y2, style) => calls.push({ kind: "line", x1, y1, x2, y2, style }),
    drawStar: (x, y, outerR, innerR, points, style) =>
      calls.push({ kind: "star", x, y, outerR, innerR, points, style }),
    drawText: (x, y, text) => calls.push({ kind: "text", x, y, text }),
    measureText: (text, fontSize) => text.length * fontSize * 0.55,
  };
  return { painter, calls };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/graph/view/__tests__/fakePainter.ts
git commit -m "test(graph): fake painter that records draw calls"
```

---

## Task T-9: drawScene — TDD

**Files:**
- Create: `packages/ui/src/graph/view/drawScene.ts`
- Create: `packages/ui/src/graph/view/__tests__/drawScene.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { drawScene } from "../drawScene";
import { createFakePainter } from "./fakePainter";
import type { Scene } from "../Painter";

const baseScene = (): Scene => ({
  nodes: [
    {
      node: { id: "a", title: "A", path: "a.md" },
      position: { id: "a", x: 100, y: 100 },
      isActive: true, isHovered: false, isStarred: false, isShared: false,
      isVisible: true, isInLocalSet: true,
    },
    {
      node: { id: "b", title: "B", path: "b.md" },
      position: { id: "b", x: 200, y: 200 },
      isActive: false, isHovered: false, isStarred: true, isShared: false,
      isVisible: true, isInLocalSet: true,
    },
  ],
  edges: [
    {
      fromPosition: { id: "a", x: 100, y: 100 },
      toPosition: { id: "b", x: 200, y: 200 },
      isActive: false, isHovered: false, isInLocalSet: true,
    },
  ],
  transform: { x: 0, y: 0, k: 1 },
  theme: "dark",
  mode: "global",
});

describe("drawScene", () => {
  it("opens a frame, draws edges before nodes, closes frame", () => {
    const { painter, calls } = createFakePainter();
    drawScene(painter, baseScene(), 400, 400);
    expect(calls[0].kind).toBe("beginFrame");
    expect(calls[calls.length - 1].kind).toBe("endFrame");
    const lineIdx = calls.findIndex((c) => c.kind === "line");
    const circleIdx = calls.findIndex((c) => c.kind === "circle");
    expect(lineIdx).toBeGreaterThan(-1);
    expect(circleIdx).toBeGreaterThan(lineIdx);
  });

  it("draws a star for starred non-active nodes", () => {
    const { painter, calls } = createFakePainter();
    drawScene(painter, baseScene(), 400, 400);
    expect(calls.some((c) => c.kind === "star")).toBe(true);
  });

  it("applies the viewport transform via translate+scale", () => {
    const { painter, calls } = createFakePainter();
    const scene = baseScene();
    scene.transform = { x: 50, y: 60, k: 2 };
    drawScene(painter, scene, 400, 400);
    const tr = calls.find((c) => c.kind === "translate") as { x: number; y: number; kind: "translate" };
    const sc = calls.find((c) => c.kind === "scale") as { s: number; kind: "scale" };
    expect(tr.x).toBe(50);
    expect(tr.y).toBe(60);
    expect(sc.s).toBe(2);
  });

  it("ghosts non-local-set elements in local mode", () => {
    const { painter, calls } = createFakePainter();
    const scene = baseScene();
    scene.mode = "local";
    scene.nodes[1].isInLocalSet = false;
    drawScene(painter, scene, 400, 400);
    const ghostedCircle = calls.find(
      (c) => c.kind === "circle" && (c.style.alpha ?? 1) < 0.5,
    );
    expect(ghostedCircle).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/ui && npm test -- drawScene`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/graph/view/drawScene.ts
import { GRAPH_CONFIG } from "../graphConfig";
import type { Painter, Scene, SceneEdge, SceneNode } from "./Painter";

export function drawScene(painter: Painter, scene: Scene, width: number, height: number): void {
  const palette = GRAPH_CONFIG.colors[scene.theme];
  painter.beginFrame(width, height);
  painter.save();
  painter.translate(scene.transform.x, scene.transform.y);
  painter.scale(scene.transform.k);

  // Edges first so nodes paint over them.
  for (const e of scene.edges) drawEdge(painter, e, palette, scene.mode);
  for (const n of scene.nodes) drawNode(painter, n, palette, scene.mode);

  painter.restore();
  painter.endFrame();
}

type Palette = typeof GRAPH_CONFIG.colors.light;

function drawEdge(p: Painter, e: SceneEdge, palette: Palette, mode: Scene["mode"]) {
  const ghosted = mode === "local" && !e.isInLocalSet;
  const stroke = e.isActive || e.isHovered ? palette.strokeHovered : palette.link;
  const alpha = ghosted ? 0.2 : e.isActive || e.isHovered ? 0.9 : 0.5;
  const strokeWidth = e.isActive || e.isHovered ? 1.5 : 1;
  p.drawLine(e.fromPosition.x, e.fromPosition.y, e.toPosition.x, e.toPosition.y, {
    stroke, strokeWidth, alpha,
  });
}

function drawNode(p: Painter, n: SceneNode, palette: Palette, mode: Scene["mode"]) {
  const ghosted = mode === "local" && !n.isInLocalSet;
  const r = n.isActive
    ? GRAPH_CONFIG.node.activeRadius
    : n.isHovered
      ? GRAPH_CONFIG.node.hoveredRadius
      : GRAPH_CONFIG.node.defaultRadius;
  const fill = n.isActive
    ? palette.nodeActive
    : n.isShared
      ? palette.nodeShared
      : palette.node;
  const stroke = n.isActive
    ? palette.strokeActive
    : n.isShared
      ? palette.strokeShared
      : n.isHovered
        ? palette.strokeHovered
        : fill;
  const baseStyle = { fill, stroke, strokeWidth: n.isActive ? 2 : 1.2, alpha: ghosted ? 0.25 : 1 };

  if (n.isStarred && !n.isActive) {
    const outerR = n.isHovered ? GRAPH_CONFIG.node.starHoveredRadius : GRAPH_CONFIG.node.starDefaultRadius;
    const innerR = outerR * GRAPH_CONFIG.node.starInnerRadiusRatio;
    p.drawStar(n.position.x, n.position.y, outerR, innerR, 5, {
      fill: palette.star, stroke: palette.starStroke, strokeWidth: 1, alpha: ghosted ? 0.25 : 1,
    });
  } else {
    p.drawCircle(n.position.x, n.position.y, r, baseStyle);
  }

  if ((n.isActive || n.isHovered) && !ghosted) {
    p.drawText(
      n.position.x,
      n.position.y + r + GRAPH_CONFIG.node.labelOffset + GRAPH_CONFIG.font.defaultSize,
      truncate(n.node.title),
      n.isActive ? GRAPH_CONFIG.font.activeSize : GRAPH_CONFIG.font.defaultSize,
      GRAPH_CONFIG.font.family,
      palette.label,
      "center",
    );
  }
}

function truncate(s: string): string {
  if (s.length <= GRAPH_CONFIG.label.maxLength) return s;
  return s.slice(0, GRAPH_CONFIG.label.truncatedLength) + GRAPH_CONFIG.label.ellipsis;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/ui && npm test -- drawScene`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/view/drawScene.ts packages/ui/src/graph/view/__tests__/drawScene.test.ts
git commit -m "feat(graph): renderer-agnostic drawScene with fake-painter tests"
```

---

## Task T-10: Hit-test (grid bucket) — TDD

**Files:**
- Create: `packages/ui/src/graph/view/hitTest.ts`
- Create: `packages/ui/src/graph/view/__tests__/hitTest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createHitTest } from "../hitTest";

describe("createHitTest", () => {
  it("returns the closest node within the radius", () => {
    const ht = createHitTest([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 200, y: 200 },
    ], 10);
    expect(ht.test(2, 2)).toBe("a");
    expect(ht.test(98, 1)).toBe("b");
    expect(ht.test(50, 50)).toBeNull();
  });

  it("rebuild resets the index", () => {
    const ht = createHitTest([{ id: "a", x: 0, y: 0 }], 10);
    ht.rebuild([{ id: "a", x: 500, y: 500 }]);
    expect(ht.test(0, 0)).toBeNull();
    expect(ht.test(498, 502)).toBe("a");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/ui && npm test -- hitTest`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/graph/view/hitTest.ts
interface HitNode { id: string; x: number; y: number }

export interface HitTest {
  test(x: number, y: number): string | null;
  rebuild(nodes: HitNode[]): void;
}

const CELL = 64;

export function createHitTest(initial: HitNode[], radius: number): HitTest {
  let buckets = new Map<string, HitNode[]>();
  let r2 = radius * radius;

  function key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  function build(nodes: HitNode[]) {
    buckets = new Map();
    for (const n of nodes) {
      const cx = Math.floor(n.x / CELL);
      const cy = Math.floor(n.y / CELL);
      const k = key(cx, cy);
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(n);
    }
  }

  build(initial);

  return {
    test(x, y) {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      let best: { id: string; d2: number } | null = null;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(key(cx + dx, cy + dy));
          if (!arr) continue;
          for (const n of arr) {
            const ddx = n.x - x;
            const ddy = n.y - y;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 <= r2 && (!best || d2 < best.d2)) best = { id: n.id, d2 };
          }
        }
      }
      return best ? best.id : null;
    },
    rebuild(nodes) {
      build(nodes);
    },
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/ui && npm test -- hitTest`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/view/hitTest.ts packages/ui/src/graph/view/__tests__/hitTest.test.ts
git commit -m "feat(graph): grid-bucket hit-test for hover/click"
```

---

## Task T-11: CanvasPainter (web/Tauri)

**Files:**
- Create: `packages/ui/src/graph/view/CanvasPainter.web.ts`
- Create: `packages/ui/src/graph/view/__tests__/CanvasPainter.web.test.ts`

- [ ] **Step 1: Write a smoke test against jsdom canvas stubs**

```ts
import { describe, it, expect, vi } from "vitest";
import { createCanvasPainter } from "../CanvasPainter.web";

describe("CanvasPainter (web)", () => {
  it("invokes the underlying 2D context for primitive ops", () => {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 42 })),
      set strokeStyle(_v: string) {},
      set fillStyle(_v: string) {},
      set lineWidth(_n: number) {},
      set globalAlpha(_n: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;

    const p = createCanvasPainter(ctx);
    p.beginFrame(400, 400);
    p.drawCircle(10, 10, 5, { fill: "red" });
    p.drawLine(0, 0, 10, 10, { stroke: "blue", strokeWidth: 1 });
    p.drawStar(0, 0, 10, 5, 5, { fill: "yellow" });
    p.drawText(0, 0, "hi", 12, "Inter", "black");
    p.endFrame();

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- CanvasPainter`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/graph/view/CanvasPainter.web.ts
import type { Painter, ScenePainterStyle } from "./Painter";

export function createCanvasPainter(ctx: CanvasRenderingContext2D): Painter {
  function applyFill(style: ScenePainterStyle) {
    if (style.fill) {
      ctx.fillStyle = style.fill;
      ctx.globalAlpha = style.alpha ?? 1;
      ctx.fill();
    }
  }
  function applyStroke(style: ScenePainterStyle) {
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth ?? 1;
      ctx.globalAlpha = style.alpha ?? 1;
      ctx.stroke();
    }
  }

  return {
    beginFrame(w, h) {
      ctx.clearRect(0, 0, w, h);
    },
    endFrame() {
      ctx.globalAlpha = 1;
    },
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    translate: (x, y) => ctx.translate(x, y),
    scale: (s) => ctx.scale(s, s),

    drawCircle(x, y, r, style) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      applyFill(style);
      applyStroke(style);
    },
    drawLine(x1, y1, x2, y2, style) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      applyStroke(style);
    },
    drawStar(x, y, outerR, innerR, points, style) {
      ctx.beginPath();
      const step = Math.PI / points;
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = i * step - Math.PI / 2;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      applyFill(style);
      applyStroke(style);
    },
    drawText(x, y, text, fontSize, fontFamily, color, align = "center") {
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = "top";
      ctx.fillText(text, x, y);
    },
    measureText(text, fontSize, fontFamily) {
      ctx.font = `${fontSize}px ${fontFamily}`;
      return ctx.measureText(text).width;
    },
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- CanvasPainter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/view/CanvasPainter.web.ts packages/ui/src/graph/view/__tests__/CanvasPainter.web.test.ts
git commit -m "feat(graph): canvas2d painter for web/Tauri"
```

---

## Task T-12: SkiaPainter (RN)

**Files:**
- Create: `packages/ui/src/graph/view/SkiaPainter.native.ts`

> **Note:** This file is only loaded when Metro resolves `.native.ts`. It cannot run in vitest (no RN runtime). It is exercised only via the native view in T-17 and the kryton-mobile integration tests when the mobile scaffold lands.

- [ ] **Step 1: Write the implementation**

```ts
// packages/ui/src/graph/view/SkiaPainter.native.ts
import {
  Skia,
  type SkCanvas,
  type SkPaint,
  PaintStyle,
} from "@shopify/react-native-skia";
import type { Painter, ScenePainterStyle } from "./Painter";

export function createSkiaPainter(canvas: SkCanvas): Painter {
  const fillPaint: SkPaint = Skia.Paint();
  fillPaint.setStyle(PaintStyle.Fill);
  const strokePaint: SkPaint = Skia.Paint();
  strokePaint.setStyle(PaintStyle.Stroke);

  function alphaize(paint: SkPaint, alpha: number) {
    const c = paint.getColor();
    paint.setColor(c | 0); // ensure 32-bit
    paint.setAlphaf(alpha);
  }

  function applyFill(style: ScenePainterStyle, fn: (p: SkPaint) => void) {
    if (!style.fill) return;
    fillPaint.setColor(Skia.Color(style.fill));
    alphaize(fillPaint, style.alpha ?? 1);
    fn(fillPaint);
  }
  function applyStroke(style: ScenePainterStyle, fn: (p: SkPaint) => void) {
    if (!style.stroke) return;
    strokePaint.setColor(Skia.Color(style.stroke));
    strokePaint.setStrokeWidth(style.strokeWidth ?? 1);
    alphaize(strokePaint, style.alpha ?? 1);
    fn(strokePaint);
  }

  return {
    beginFrame(w, h) {
      canvas.clear(Skia.Color("transparent"));
      // bound w/h are used by the parent <Canvas> in GraphView.native; no-op here
      void w; void h;
    },
    endFrame() {},
    save: () => { canvas.save(); },
    restore: () => { canvas.restore(); },
    translate: (x, y) => { canvas.translate(x, y); },
    scale: (s) => { canvas.scale(s, s); },

    drawCircle(x, y, r, style) {
      applyFill(style, (paint) => canvas.drawCircle(x, y, r, paint));
      applyStroke(style, (paint) => canvas.drawCircle(x, y, r, paint));
    },
    drawLine(x1, y1, x2, y2, style) {
      applyStroke(style, (paint) => canvas.drawLine(x1, y1, x2, y2, paint));
    },
    drawStar(x, y, outerR, innerR, points, style) {
      const path = Skia.Path.Make();
      const step = Math.PI / points;
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = i * step - Math.PI / 2;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
      path.close();
      applyFill(style, (paint) => canvas.drawPath(path, paint));
      applyStroke(style, (paint) => canvas.drawPath(path, paint));
    },
    drawText(x, y, text, fontSize, fontFamily, color, align = "center") {
      const font = Skia.Font(Skia.FontMgr.System().matchFamilyStyle(fontFamily, Skia.FontStyle.Normal()), fontSize);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(color));
      const width = font.getTextWidth(text);
      const dx = align === "center" ? -width / 2 : align === "right" ? -width : 0;
      canvas.drawText(text, x + dx, y + fontSize, paint, font);
    },
    measureText(text, fontSize, fontFamily) {
      const font = Skia.Font(Skia.FontMgr.System().matchFamilyStyle(fontFamily, Skia.FontStyle.Normal()), fontSize);
      return font.getTextWidth(text);
    },
  };
}
```

- [ ] **Step 2: Compile-check (no test runtime available)**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors. (RN-Skia types are pulled in via `peerDependencies`.)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/graph/view/SkiaPainter.native.ts
git commit -m "feat(graph): RN-Skia painter for mobile"
```

---

## Task T-13: useViewport (web) — pointer events + wheel

**Files:**
- Create: `packages/ui/src/graph/gestures/useViewport.web.ts`
- Create: `packages/ui/src/graph/gestures/__tests__/useViewport.web.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { applyWheelZoom, applyPanDelta, clampScale } from "../useViewport.web";

describe("viewport math (web)", () => {
  it("clampScale respects min/max", () => {
    expect(clampScale(10)).toBe(5);
    expect(clampScale(0.05)).toBe(0.2);
    expect(clampScale(1)).toBe(1);
  });

  it("applyWheelZoom keeps the focal point stable", () => {
    const before = { x: 0, y: 0, k: 1 };
    const after = applyWheelZoom(before, /*deltaY=*/-100, /*focalX=*/200, /*focalY=*/100);
    // After zooming in at (200,100), the world point under (200,100) must
    // still project to (200,100) with the new transform.
    const worldX = (200 - before.x) / before.k;
    const screenX = worldX * after.k + after.x;
    expect(screenX).toBeCloseTo(200, 4);
  });

  it("applyPanDelta translates by exactly delta", () => {
    const v = applyPanDelta({ x: 5, y: 5, k: 2 }, 10, -3);
    expect(v).toEqual({ x: 15, y: 2, k: 2 });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- useViewport.web`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/graph/gestures/useViewport.web.ts
import { useEffect, useRef, useState } from "react";
import { GRAPH_CONFIG } from "../graphConfig";

export interface Viewport { x: number; y: number; k: number }

export function clampScale(k: number): number {
  return Math.max(GRAPH_CONFIG.zoom.scaleMin, Math.min(GRAPH_CONFIG.zoom.scaleMax, k));
}

export function applyWheelZoom(v: Viewport, deltaY: number, focalX: number, focalY: number): Viewport {
  const factor = Math.exp(-deltaY / 300);
  const k = clampScale(v.k * factor);
  // Keep focal world-point stationary on screen.
  const worldX = (focalX - v.x) / v.k;
  const worldY = (focalY - v.y) / v.k;
  return { k, x: focalX - worldX * k, y: focalY - worldY * k };
}

export function applyPanDelta(v: Viewport, dx: number, dy: number): Viewport {
  return { x: v.x + dx, y: v.y + dy, k: v.k };
}

export interface UseViewportResult {
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  bind: (el: HTMLElement | null) => void;
}

export function useViewport(): UseViewportResult {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const elRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startV: Viewport } | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      setViewport((v) => applyWheelZoom(v, e.deltaY, e.clientX - rect.left, e.clientY - rect.top));
    }
    function onPointerDown(e: PointerEvent) {
      el!.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, startV: viewport };
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setViewport(applyPanDelta(dragRef.current.startV, dx, dy));
    }
    function onPointerUp(e: PointerEvent) {
      if (!dragRef.current) return;
      el!.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [viewport]);

  return { viewport, setViewport, bind: (el) => { elRef.current = el; } };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- useViewport.web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/gestures/useViewport.web.ts packages/ui/src/graph/gestures/__tests__/useViewport.web.test.ts
git commit -m "feat(graph): web viewport hook (pointer + wheel)"
```

---

## Task T-14: useViewport (RN) — RNGH pinch + pan

**Files:**
- Create: `packages/ui/src/graph/gestures/useViewport.native.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/ui/src/graph/gestures/useViewport.native.ts
import { useMemo } from "react";
import { Gesture, type GestureType } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { GRAPH_CONFIG } from "../graphConfig";

export interface NativeViewport {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  k: SharedValue<number>;
  gesture: GestureType;
}

export function useViewport(): NativeViewport {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const k = useSharedValue(1);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onChange((e) => {
          tx.value += e.changeX;
          ty.value += e.changeY;
        }),
    [tx, ty],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          const next = Math.max(
            GRAPH_CONFIG.zoom.scaleMin,
            Math.min(GRAPH_CONFIG.zoom.scaleMax, k.value * e.scale),
          );
          // Focal-point stable: world point under focal must stay put.
          const worldX = (e.focalX - tx.value) / k.value;
          const worldY = (e.focalY - ty.value) / k.value;
          k.value = next;
          tx.value = e.focalX - worldX * next;
          ty.value = e.focalY - worldY * next;
        }),
    [k, tx, ty],
  );

  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);
  return { tx, ty, k, gesture };
}
```

- [ ] **Step 2: Compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/graph/gestures/useViewport.native.ts
git commit -m "feat(graph): RN viewport hook (RNGH pinch + pan)"
```

---

## Task T-15: useNodeDrag (cross-platform) — TDD

**Files:**
- Create: `packages/ui/src/graph/gestures/useNodeDrag.ts`
- Create: `packages/ui/src/graph/gestures/__tests__/useNodeDrag.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { applyDragStart, applyDragMove, applyDragEnd } from "../useNodeDrag";
import type { LayoutHandle } from "../../layout/types";

function fakeLayout(): LayoutHandle {
  return {
    step: vi.fn(),
    getPosition: vi.fn(),
    positions: vi.fn(() => [].values()),
    pin: vi.fn(),
    unpin: vi.fn(),
    reheat: vi.fn(),
    setBounds: vi.fn(),
    dispose: vi.fn(),
  } as unknown as LayoutHandle;
}

describe("node drag flow", () => {
  it("pins on start", () => {
    const l = fakeLayout();
    applyDragStart(l, "n1", 10, 20);
    expect(l.pin).toHaveBeenCalledWith("n1", 10, 20);
  });

  it("repins on move", () => {
    const l = fakeLayout();
    applyDragMove(l, "n1", 30, 40);
    expect(l.pin).toHaveBeenCalledWith("n1", 30, 40);
  });

  it("unpins and reheats on end", () => {
    const l = fakeLayout();
    applyDragEnd(l, "n1");
    expect(l.unpin).toHaveBeenCalledWith("n1");
    expect(l.reheat).toHaveBeenCalledWith(0.1);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/ui && npm test -- useNodeDrag`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/ui/src/graph/gestures/useNodeDrag.ts
import type { LayoutHandle } from "../layout/types";

export function applyDragStart(layout: LayoutHandle, id: string, worldX: number, worldY: number) {
  layout.pin(id, worldX, worldY);
}
export function applyDragMove(layout: LayoutHandle, id: string, worldX: number, worldY: number) {
  layout.pin(id, worldX, worldY);
}
export function applyDragEnd(layout: LayoutHandle, id: string) {
  layout.unpin(id);
  layout.reheat(0.1);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/ui && npm test -- useNodeDrag`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/graph/gestures/useNodeDrag.ts packages/ui/src/graph/gestures/__tests__/useNodeDrag.test.ts
git commit -m "feat(graph): cross-platform node drag helpers"
```

---

## Task T-16: GraphView (web)

**Files:**
- Create: `packages/ui/src/graph/view/GraphView.web.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/graph/view/GraphView.web.tsx
import * as React from "react";
import { Loader2 } from "lucide-react";
import { createLayout } from "../layout";
import type { LayoutHandle, LayoutMode } from "../layout/types";
import { createCanvasPainter } from "./CanvasPainter.web";
import { drawScene } from "./drawScene";
import { createHitTest, type HitTest } from "./hitTest";
import { useViewport } from "../gestures/useViewport.web";
import { applyDragStart, applyDragMove, applyDragEnd } from "../gestures/useNodeDrag";
import type { GraphData, HoveredNodeInfo } from "../types";
import type { Scene } from "./Painter";
import { GRAPH_CONFIG } from "../graphConfig";

export interface GraphViewProps {
  graphData: GraphData | null;
  loading?: boolean;
  activeNotePath?: string | null;
  mode?: "full" | "local";
  onNoteSelect: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
  starredPaths?: Set<string>;
  className?: string;
}

export function GraphView({
  graphData, loading = false, activeNotePath = null, mode = "full",
  onNoteSelect, onNodeHover, recenterRef, starredPaths, className,
}: GraphViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const layoutRef = React.useRef<LayoutHandle | null>(null);
  const hitRef = React.useRef<HitTest | null>(null);
  const hoverRef = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ id: string } | null>(null);
  const { viewport, bind, setViewport } = useViewport();
  const layoutMode: LayoutMode = mode === "full" ? "global" : "local";

  // Build / rebuild layout when graphData, mode, or activeNotePath changes.
  React.useEffect(() => {
    if (!graphData) return;
    layoutRef.current?.dispose();
    const canvas = canvasRef.current!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
    layoutRef.current = createLayout({
      nodes: graphData.nodes, edges: graphData.edges, mode: layoutMode,
      activeId, width: w, height: h,
    });
    hitRef.current = createHitTest(
      [...layoutRef.current.positions()],
      Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
    );
  }, [graphData, layoutMode, activeNotePath]);

  // Recenter handle.
  React.useEffect(() => {
    if (!recenterRef) return;
    recenterRef.current = () => setViewport({ x: 0, y: 0, k: 1 });
  }, [recenterRef, setViewport]);

  // Render loop.
  React.useEffect(() => {
    let raf = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      const layout = layoutRef.current;
      const hit = hitRef.current;
      if (canvas && layout && graphData) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.clientWidth, h = canvas.clientHeight;
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          layout.step();
          hit?.rebuild([...layout.positions()]);

          const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
          const localSet = computeLocalSet(graphData, activeId, layoutMode);
          const scene: Scene = {
            transform: viewport,
            theme: detectTheme(),
            mode: layoutMode,
            nodes: graphData.nodes.map((n) => {
              const pos = layout.getPosition(n.id);
              return {
                node: n,
                position: pos ?? { id: n.id, x: 0, y: 0 },
                isActive: n.id === activeId,
                isHovered: n.id === hoverRef.current,
                isStarred: !!(starredPaths && starredPaths.has(n.path)),
                isShared: !!n.shared,
                isVisible: !!pos,
                isInLocalSet: localSet ? localSet.has(n.id) : true,
              };
            }),
            edges: graphData.edges
              .map((e) => {
                const fp = layout.getPosition(e.fromNoteId);
                const tp = layout.getPosition(e.toNoteId);
                if (!fp || !tp) return null;
                return {
                  fromPosition: fp,
                  toPosition: tp,
                  isActive: e.fromNoteId === activeId || e.toNoteId === activeId,
                  isHovered: e.fromNoteId === hoverRef.current || e.toNoteId === hoverRef.current,
                  isInLocalSet: localSet
                    ? localSet.has(e.fromNoteId) && localSet.has(e.toNoteId)
                    : true,
                };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null),
          };

          drawScene(createCanvasPainter(ctx), scene, w, h);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graphData, viewport, activeNotePath, layoutMode, starredPaths]);

  // Hover + click + drag from pointer events on the wrapper.
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wx = (sx - viewport.x) / viewport.k;
    const wy = (sy - viewport.y) / viewport.k;
    if (dragRef.current) {
      applyDragMove(layoutRef.current!, dragRef.current.id, wx, wy);
      return;
    }
    const id = hitRef.current?.test(wx, wy) ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      if (onNodeHover) {
        const n = id ? graphData?.nodes.find((x) => x.id === id) : null;
        onNodeHover(n ? { path: n.path, title: n.title, x: sx, y: sy } : null);
      }
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wx = (e.clientX - rect.left - viewport.x) / viewport.k;
    const wy = (e.clientY - rect.top - viewport.y) / viewport.k;
    const id = hitRef.current?.test(wx, wy);
    if (id) {
      dragRef.current = { id };
      applyDragStart(layoutRef.current!, id, wx, wy);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      // If the pointer didn't move much, treat as click.
      applyDragEnd(layoutRef.current!, dragRef.current.id);
      const node = graphData?.nodes.find((n) => n.id === dragRef.current!.id);
      if (node) onNoteSelect(node.path);
      dragRef.current = null;
      void e;
    }
  };

  return (
    <div
      className={className ?? "relative flex flex-1 overflow-hidden"}
      ref={(el) => bind(el)}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      aria-label="Knowledge graph"
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-violet-500" aria-label="Loading graph…" />
        </div>
      )}
      {graphData && graphData.nodes.length === 0 && !loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
          No notes yet
        </div>
      )}
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function detectTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function computeLocalSet(
  data: GraphData, activeId: string | null, mode: LayoutMode,
): Set<string> | null {
  if (mode !== "local" || !activeId) return null;
  const set = new Set<string>([activeId]);
  const adj = new Map<string, Set<string>>();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const e of data.edges) {
    adj.get(e.fromNoteId)?.add(e.toNoteId);
    adj.get(e.toNoteId)?.add(e.fromNoteId);
  }
  for (const id of adj.get(activeId) ?? []) {
    set.add(id);
    for (const id2 of adj.get(id) ?? []) set.add(id2);
  }
  return set;
}
```

- [ ] **Step 2: Compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/graph/view/GraphView.web.tsx
git commit -m "feat(graph): web GraphView (canvas2d painter, pointer events)"
```

---

## Task T-17: GraphView (RN)

**Files:**
- Create: `packages/ui/src/graph/view/GraphView.native.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/graph/view/GraphView.native.tsx
import * as React from "react";
import { View } from "react-native";
import {
  Canvas,
  useCanvasRef,
  useFrameCallback,
  GestureHandlerRootView,
} from "@shopify/react-native-skia";
import { GestureDetector } from "react-native-gesture-handler";
import { createLayout } from "../layout";
import type { LayoutHandle, LayoutMode } from "../layout/types";
import { createSkiaPainter } from "./SkiaPainter.native";
import { drawScene } from "./drawScene";
import { createHitTest, type HitTest } from "./hitTest";
import { useViewport } from "../gestures/useViewport.native";
import type { GraphData, HoveredNodeInfo } from "../types";
import type { Scene } from "./Painter";
import { GRAPH_CONFIG } from "../graphConfig";

export interface GraphViewProps {
  graphData: GraphData | null;
  loading?: boolean;
  activeNotePath?: string | null;
  mode?: "full" | "local";
  onNoteSelect: (path: string) => void;
  onNodeHover?: (node: HoveredNodeInfo | null) => void;
  recenterRef?: React.MutableRefObject<(() => void) | null>;
  starredPaths?: Set<string>;
  className?: string;
}

export function GraphView({
  graphData, activeNotePath = null, mode = "full",
  onNoteSelect, starredPaths,
}: GraphViewProps) {
  const canvasRef = useCanvasRef();
  const layoutRef = React.useRef<LayoutHandle | null>(null);
  const hitRef = React.useRef<HitTest | null>(null);
  const hoverRef = React.useRef<string | null>(null);
  const layoutMode: LayoutMode = mode === "full" ? "global" : "local";
  const { tx, ty, k, gesture } = useViewport();
  const [size, setSize] = React.useState({ w: 360, h: 360 });

  React.useEffect(() => {
    if (!graphData) return;
    layoutRef.current?.dispose();
    const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
    layoutRef.current = createLayout({
      nodes: graphData.nodes, edges: graphData.edges, mode: layoutMode,
      activeId, width: size.w, height: size.h,
    });
    hitRef.current = createHitTest(
      [...layoutRef.current.positions()],
      Math.sqrt(GRAPH_CONFIG.node.hitTestRadiusSq),
    );
  }, [graphData, layoutMode, activeNotePath, size.w, size.h]);

  useFrameCallback(() => {
    const layout = layoutRef.current;
    const canvas = canvasRef.current?.getRecordingCanvas?.();
    if (!layout || !canvas || !graphData) return;
    layout.step();
    hitRef.current?.rebuild([...layout.positions()]);
    const activeId = graphData.nodes.find((n) => n.path === activeNotePath)?.id ?? null;
    const scene: Scene = {
      transform: { x: tx.value, y: ty.value, k: k.value },
      theme: "dark",
      mode: layoutMode,
      nodes: graphData.nodes.map((n) => {
        const pos = layout.getPosition(n.id);
        return {
          node: n,
          position: pos ?? { id: n.id, x: 0, y: 0 },
          isActive: n.id === activeId,
          isHovered: n.id === hoverRef.current,
          isStarred: !!(starredPaths && starredPaths.has(n.path)),
          isShared: !!n.shared,
          isVisible: !!pos,
          isInLocalSet: true,
        };
      }),
      edges: graphData.edges
        .map((e) => {
          const fp = layout.getPosition(e.fromNoteId);
          const tp = layout.getPosition(e.toNoteId);
          if (!fp || !tp) return null;
          return {
            fromPosition: fp,
            toPosition: tp,
            isActive: e.fromNoteId === activeId || e.toNoteId === activeId,
            isHovered: false,
            isInLocalSet: true,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null),
    };
    drawScene(createSkiaPainter(canvas), scene, size.w, size.h);
  });

  const onTap = (e: { x: number; y: number }) => {
    const wx = (e.x - tx.value) / k.value;
    const wy = (e.y - ty.value) / k.value;
    const id = hitRef.current?.test(wx, wy);
    if (id) {
      const node = graphData?.nodes.find((n) => n.id === id);
      if (node) onNoteSelect(node.path);
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={gesture}>
        <View
          style={{ flex: 1 }}
          onLayout={(ev) => setSize({ w: ev.nativeEvent.layout.width, h: ev.nativeEvent.layout.height })}
          onTouchEnd={(e) => onTap({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })}
        >
          <Canvas style={{ flex: 1 }} ref={canvasRef} />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/graph/view/GraphView.native.tsx
git commit -m "feat(graph): RN GraphView (Skia + RNGH)"
```

---

## Task T-18: Public barrel — replace old export

**Files:**
- Modify: `packages/ui/src/graph/index.ts`

- [ ] **Step 1: Replace contents**

```ts
// packages/ui/src/graph/index.ts
export { GraphView } from "./view/GraphView.web"; // resolved per-platform via .web/.native
export type { GraphViewProps } from "./view/GraphView.web";
export type { GraphData, GraphNode, GraphEdge, HoveredNodeInfo } from "./types";
```

> Note: bundlers/Metro will replace `./view/GraphView.web` with `./view/GraphView.native` on RN. The `.web` suffix in the import is acceptable because both files declare the same symbol. If your toolchain prefers a bare specifier, change to `"./view/GraphView"` and rename source files to `GraphView.web.tsx` and `GraphView.native.tsx` (already so) — most resolvers strip `.web`/`.native` automatically.

- [ ] **Step 2: Update the barrel to use bare specifier (preferred)**

Replace contents with:

```ts
// packages/ui/src/graph/index.ts
export { GraphView } from "./view/GraphView";
export type { GraphViewProps } from "./view/GraphView";
export type { GraphData, GraphNode, GraphEdge, HoveredNodeInfo } from "./types";
```

Then add a stub `packages/ui/src/graph/view/GraphView.ts` that re-exports for type purposes only:

```ts
// packages/ui/src/graph/view/GraphView.ts
// Type-only stub. Bundlers resolve GraphView.web.tsx or GraphView.native.tsx
// at build time via platform extensions.
export type { GraphViewProps } from "./GraphView.web";
export { GraphView } from "./GraphView.web";
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/graph/index.ts packages/ui/src/graph/view/GraphView.ts
git commit -m "feat(graph): public barrel routes through platform-resolved GraphView"
```

---

## Task T-19: Delete old graph implementation

**Files:**
- Delete: `packages/ui/src/graph/useD3Graph.ts`
- Delete: `packages/ui/src/graph/GraphView.tsx`
- Delete: `packages/ui/src/graph/__tests__/graph.test.tsx`

- [ ] **Step 1: Verify no in-source imports of the old files remain**

Run: `grep -rn "from.*useD3Graph\|from.*graph/GraphView\"" packages/`
Expected: only the new view files.

- [ ] **Step 2: Delete**

Run:
```bash
rm packages/ui/src/graph/useD3Graph.ts
rm packages/ui/src/graph/GraphView.tsx
rm packages/ui/src/graph/__tests__/graph.test.tsx
```

- [ ] **Step 3: Run the full ui test suite**

Run: `cd packages/ui && npm test`
Expected: PASS — only new tests run; no orphaned references.

- [ ] **Step 4: Commit**

```bash
git add -A packages/ui/src/graph/
git commit -m "chore(graph): remove d3-based useD3Graph and old GraphView"
```

---

## Task T-20: Drop d3 from `@azrtydxb/client`

**Files:**
- Modify: `packages/client/package.json`

- [ ] **Step 1: Remove `d3` and `@types/d3` from dependencies**

Run: `cd packages/client && npm uninstall d3 @types/d3`
Expected: removed.

- [ ] **Step 2: Confirm no client-side imports remain**

Run: `grep -rn "from ['\"]d3" packages/client/src/`
Expected: no hits.

- [ ] **Step 3: Build the client**

Run: `cd packages/client && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/package.json package-lock.json
git commit -m "deps(client): remove d3 (graph subsystem migrated to ngraph+painter)"
```

---

## Task T-21: Acceptance verification

**Files:** none modified — verification only.

- [ ] **Step 1: Repo-wide d3 grep**

Run: `grep -rn "from ['\"]d3" packages/ --include='*.ts' --include='*.tsx'`
Expected: no output.

- [ ] **Step 2: Repo-wide package.json check**

Run: `grep -rn '"d3"\|"@types/d3"' packages/*/package.json`
Expected: no output.

- [ ] **Step 3: WASM artefact check on web build**

Run: `cd packages/client && npm run build && find dist -name '*.wasm'`
Expected: no output.

- [ ] **Step 4: Run full monorepo test suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Open the web app and verify visual parity**

Run: `cd packages/client && npm run dev`
Then in a browser:
- Open a note with backlinks; confirm side-rail graph renders.
- Switch local ↔ global; confirm reheat animates without teleport.
- Click a node; confirm note opens.
- Pinch/wheel zoom; confirm focal-point stability.
- Drag a node; confirm it follows the cursor and releases naturally.
- Open the full-screen overlay; confirm it works.

- [ ] **Step 6: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(graph): cross-platform renderer (no d3, no WASM, no WebView shim) — acceptance verified"
```

---

## Self-review notes

- Spec coverage: tasks T-1..T-21 cover all spec sections — layout module (T-3..T-6), Painter+drawScene (T-7..T-9), hitTest (T-10), painters (T-11..T-12), gestures (T-13..T-15), views (T-16..T-17), barrel (T-18), removal (T-19..T-20), acceptance (T-21). Build-config sanity (T-1) and dep swap (T-2) up front.
- Type consistency: `LayoutHandle`, `Scene`, `Painter`, `Viewport` types are defined exactly once and reused unchanged across tasks.
- No placeholders. Every code-producing step shows the code; every shell step shows the command and expected output.
- The mobile/desktop scaffold integration is explicitly out of this plan; this plan ships the `@azrtydxb/ui` graph subsystem to readiness for those scaffolds when they land.
