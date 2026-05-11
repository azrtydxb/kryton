# Graph Cross-Platform Renderer

**Date**: 2026-05-08
**Status**: Implemented (`packages/ui/src/graph/` ships the layout/painter/gestures architecture; web build uses `CanvasPainter.web` + `useViewport.web`; React Native build uses `SkiaPainter.native` + `useViewport.native`; shared `drawScene.ts` + `hitTest.ts`).
**Supersedes**: [2026-03-28-graph-layout-redesign.md](./2026-03-28-graph-layout-redesign.md)

## Problem

The graph view ([packages/ui/src/graph/](../../../packages/ui/src/graph/)) is built on **d3** (force, zoom, drag, selection) rendering to **HTML `<canvas>`**. It works in the browser and inside Tauri (a webview), but it cannot run on **kryton-mobile** (React Native): RN has no `HTMLCanvasElement`, no DOM, and `d3-zoom` / `d3-drag` / `d3-selection` are inert.

The 2026-03-28 spec patched the gap by routing mobile through a WebView with inline canvas+d3. That ships a browser inside the native app for one screen — which is exactly what the rest of kryton-mobile is designed to avoid. The graph there feels like a foreign panel, not a native view.

We also want **zero d3 in the production dependency graph**. d3-force is pure math and would technically port, but shipping a d3 subset on every platform is a tax on bundle, audit surface, and mental model that we do not need to pay.

## Targets

- **kryton (web)** — browser, HTML/JS, as today.
- **kryton-desktop** — Tauri, hosts the web build of the renderer unchanged.
- **kryton-mobile** — React Native, native rendering, no WebView shim for the graph.

## Design

### Architecture: layout / painter / gestures, no d3, no WASM

```
packages/ui/src/graph/
  layout/                          pure JS, no DOM, no React
    forceLayout.ts                 ngraph.forcelayout wrapper, global mode
    localLayout.ts                 concentric ring layout, local mode (2-hop)
    types.ts                       LayoutNode, LayoutEdge, LayoutHandle
    index.ts
  view/
    Painter.ts                     interface (drawCircle, drawLine, drawText, drawPath, save/restore, transform)
    drawScene.ts                   shared scene logic: (painter, scene) => void
    CanvasPainter.web.ts           HTMLCanvasElement 2D-context impl
    SkiaPainter.native.ts          @shopify/react-native-skia impl (native bindings)
    GraphView.web.tsx              <canvas> + raf loop
    GraphView.native.tsx           <Canvas> from RN-Skia + useFrameCallback
    hitTest.ts                     grid-bucket spatial index for hover/click
  gestures/
    useViewport.web.ts             pointer events, wheel zoom
    useViewport.native.ts          react-native-gesture-handler pinch/pan
    useNodeDrag.ts                 shared: pin(id, x, y) while held, unpin on release
  graphConfig.ts                   unchanged
  index.ts
```

Three independent layers, each replaceable in isolation:

1. **Layout** — consumes `{nodes, edges, mode, activeId}`, produces a `LayoutHandle` exposing `step()`, `getPosition(id)`, `pin(id, x, y)`, `unpin(id)`, `reheat(alpha)`, `setBounds(w, h)`, `dispose()`. Drives `requestAnimationFrame` on web/Tauri, `useFrameCallback` (Reanimated) on RN.
2. **View** — a `Painter` interface and a single `drawScene(painter, scene)` function shared by both backends. Two thin painter implementations:
   - **`CanvasPainter` (web/Tauri)** — `HTMLCanvasElement.getContext('2d')`. ~120 LOC. Zero new dependencies on web.
   - **`SkiaPainter` (RN)** — `@shopify/react-native-skia` native bindings. ~120 LOC. No JS-bundle bloat (native binary), no WASM.
   - Metro / Webpack platform extensions (`.web.tsx` / `.native.tsx`) pick the right one automatically.
3. **Gestures** — pointer + wheel events on web/Tauri, `react-native-gesture-handler` on RN. The `{x, y, k}` viewport transform is a 9-line matrix we own; no `d3-zoom` semantics to mirror.

### Why this gives "native feel" on every platform

| Platform | Renderer | Bundle additions | WASM | WebView shim |
|---|---|---|---|---|
| Web (kryton) | `canvas2d` | ngraph (~6 KB) + painter (~120 LOC) | none | n/a |
| Desktop (Tauri) | `canvas2d` (web build) | same as web | none | none beyond Tauri itself |
| Mobile (RN) | RN-Skia native | ngraph (~6 KB) + painter (~120 LOC) + RN-Skia native binary | none | **none** — the WebView graph from the 2026-03-28 spec is gone |

The mobile graph is drawn directly by Skia's native renderer on the GPU, with native gestures from `react-native-gesture-handler`. There is no browser involved on the mobile path.

### Layout engine: `ngraph.forcelayout`, not d3-force

| | d3-force | ngraph.forcelayout |
|---|---|---|
| Size (min+gz) | ~30 KB w/ d3-quadtree | ~6 KB |
| DOM deps | none | none |
| Algorithm | Velocity Verlet + Barnes-Hut | Velocity Verlet + Barnes-Hut |
| 1k-node tick | baseline | ~2–3× faster (published benches) |
| 3D variant | no | yes (`ngraph.forcelayout3d`, future option) |
| Maintenance | Mike Bostock | Andrei Kashcha, active |

We use it via a thin wrapper (`forceLayout.ts`) that exposes only the `LayoutHandle` API. The wrapper owns a defensive copy of the input graph so consumers never see ngraph's internal node mutation.

Force parameters from the 2026-03-28 spec carry over verbatim — they live in [graphConfig.ts](../../../packages/ui/src/graph/graphConfig.ts) and map 1:1 onto ngraph's `physicsSettings`:

| 2026-03-28 (d3) | ngraph |
|---|---|
| `forceManyBody().strength(-400)` | `gravity: -400` |
| `forceLink().distance(150)` | `springLength: 150` |
| `forceCollide().radius(40)` | post-step collision pass (we own; ~30 LOC) |
| `forceRadial(r).strength(s)` | `dragCoefficient` + per-node target via `pinNode` / step hook |
| `alphaDecay`, `velocityDecay` | `theta`, `timeStep` |

The radial / ring layout for local mode is implemented in `localLayout.ts` as a separate, *non-physics* layout: it computes ring positions analytically (active at center, 1-hop on `0.3 * min(w,h)` ring, 2-hop on `0.55 * min(w,h)` ring), then runs a short tangential-only relaxation pass to spread nodes along each ring. Cheaper than running ngraph for it and gives a more deterministic look.

### Gestures: hand-rolled, ~150 LOC total

We do not need d3-zoom's full surface. The interactions we use:

- Pinch zoom (mobile) / wheel zoom (web/Tauri)
- Two-finger pan (mobile) / click-drag pan (web/Tauri)
- Single tap → select node
- Long-press / mouse-down on a node → drag, `layout.pin(id, x, y)` while held, `unpin(id)` + `reheat(0.1)` on release
- Double-tap empty space → recenter (programmatic via `recenterRef`)
- Pinch / wheel clamps to `scaleMin: 0.2`, `scaleMax: 5` from `graphConfig.zoom`

On RN, `react-native-gesture-handler` provides the gesture primitives. On web/Tauri, plain pointer events + `wheel`. The transform is a `{x, y, k}` shared value (Reanimated on RN, plain React state on web).

### Behaviour parity with the 2026-03-28 spec

All visual behaviour from the prior spec carries over unchanged:

- Global mode tuned force-directed layout (charge -400, link 150, collision 40)
- Local mode 2-hop concentric rings, active pinned at center
- Soft active-node centering via radial pull, not `fx/fy`, in global
- Reheat `alpha ~0.5` on mode change
- Full-screen overlay (`Maximize2` → `Minimize2` / `Esc`) opening `mode="full"`
- Active = green, default = violet, shared = orange, starred = star shape

These are renderer-agnostic and live in `graphConfig.ts` + the layout modules.

### Mobile parity

The 2026-03-28 mobile-via-WebView path goes away. `kryton-mobile` imports `<GraphView>` from `@kryton/ui` directly; Metro picks up `GraphView.native.tsx`. Same layout module, same `drawScene` logic, native Skia rendering, native gestures. Ring radii already scale to canvas dimensions via `setBounds(w, h)`.

Local mode remains the default when `activeNotePath` is set on mobile — that's a prop choice in the consuming screen, not in the renderer.

## Changes

| File / package | Change |
|---|---|
| `packages/ui/package.json` | Remove `d3`, `@types/d3`. Add `ngraph.forcelayout`, `ngraph.graph`, `@shopify/react-native-skia` (native peer), `react-native-gesture-handler`, `react-native-reanimated`. |
| `packages/client/package.json` | Remove `d3`, `@types/d3`. No new runtime deps on web (canvas2d is browser-native). |
| `packages/ui/src/graph/useD3Graph.ts` | **Deleted.** Replaced by `layout/`, `view/`, `gestures/`. |
| `packages/ui/src/graph/GraphView.tsx` | **Deleted.** Replaced by `view/GraphView.web.tsx` and `view/GraphView.native.tsx` (same prop surface). |
| `packages/ui/src/graph/layout/` | New: `forceLayout.ts`, `localLayout.ts`, `types.ts`, `index.ts`. Pure JS. |
| `packages/ui/src/graph/view/` | New: `Painter.ts`, `drawScene.ts`, `CanvasPainter.web.ts`, `SkiaPainter.native.ts`, `GraphView.web.tsx`, `GraphView.native.tsx`, `hitTest.ts`. |
| `packages/ui/src/graph/gestures/` | New: `useViewport.web.ts`, `useViewport.native.ts`, `useNodeDrag.ts`. |
| `packages/ui/src/graph/__tests__/` | Existing tests moved/rewritten: layout tests run as pure-JS unit tests (faster, no jsdom canvas shim); painter tests use a fake painter that records draw calls; native view smoke tests use RN-Skia's test utilities. |
| `packages/ui/src/graph/graphConfig.ts` | Unchanged. |
| Build config | Confirm Webpack / Vite resolves `.web.tsx` and Metro resolves `.native.tsx` for the `view/` and `gestures/` modules. |
| `kryton-mobile/...graph.tsx` | (When mobile scaffold lands) imports `<GraphView>` from `@kryton/ui` instead of WebView shim. |
| `kryton-desktop/...` | No graph-specific changes; Tauri picks up the web build. |

## Not Changing

- Public API surface of `GraphView` (props are stable — consumers don't change).
- `graphConfig.ts` values (force tuning, colors, node radii, fonts).
- Visual behaviour from 2026-03-28 (global tuned forces, local rings, soft centering, full-screen overlay, mode-transition reheat).
- Graph data fetching, API endpoints, `GraphData` / `GraphNode` / `GraphEdge` types.
- Node styling palette (active green, default violet, shared orange, star shape).
- Tauri as the desktop wrapper.

## Risks & Open Questions

1. **Painter divergence over time.** Two implementations of one interface can drift. Mitigated by: (a) keeping all scene logic in `drawScene.ts` so painters only implement primitives, and (b) a fake-painter test that records draw calls and is asserted against on both web and native via the same fixtures.
2. **Skia text metrics differ from canvas2d text metrics.** Label truncation logic ([graphConfig.ts:47-51](../../../packages/ui/src/graph/graphConfig.ts#L47-L51)) may render slightly differently. Visual snapshot tests on each backend catch regressions; if needed, the painter interface gains a `measureText` primitive so truncation is computed identically per platform.
3. **react-native-gesture-handler version pinning.** RN-Skia, RNGH, and Reanimated form a tight version triplet on RN. Pin all three in `packages/ui/package.json` peerDependencies and document the matrix.
4. **Hand-rolled zoom edge cases d3-zoom handled for free.** Wheel inertia, double-tap-to-zoom-in, pinch-around-focal-point. We re-implement focal-point pinch (the only one that matters); inertia and double-tap-zoom are explicitly out of scope for v1.
5. **ngraph's smaller community vs d3.** We use a small surface (forces, step, getNodePosition, pinNode); the source is ~600 LOC, readable end-to-end. Risk is low but real.
6. **Build-config validation.** Metro/Webpack/Vite must resolve the `.web.tsx` / `.native.tsx` extensions consistently across the monorepo. This is a one-time setup verification, but worth doing in phase 0 of the plan, not at integration time.
7. **kryton-mobile and kryton-desktop scaffolds are empty.** This spec is renderer-only; integration into those apps is gated on their own scaffold plans landing first ([2026-04-30-mobile-core-migration.md](../plans/2026-04-30-mobile-core-migration.md), [2026-04-30-kryton-desktop-core.md](../plans/2026-04-30-kryton-desktop-core.md)).

## Acceptance

- `grep -r "from ['\"]d3" packages/` returns zero hits in source (excluding node_modules).
- `d3` and `@types/d3` are absent from every `package.json` under `packages/`.
- No `*.wasm` artefacts in any production bundle (web, Tauri, mobile).
- Web/Tauri graph renders the same visual behaviour as the 2026-03-28 spec on a 200-node test vault.
- Mobile graph renders the same visual behaviour, natively (no embedded WebView for the graph screen).
- Layout module has unit tests covering: global tick stability, local ring placement, pin/unpin, reheat, bounds change. No DOM, no jsdom.
- Scene-drawing tests use a fake painter and run on both web and native runtimes against the same fixtures.
- Gesture module has interaction tests for pinch, pan, tap, long-press-drag.
