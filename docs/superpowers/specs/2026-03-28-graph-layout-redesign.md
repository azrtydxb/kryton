# Graph Layout Redesign

**Date**: 2026-03-28
**Status**: Approved

## Problem

The graph view uses a basic force-directed layout with weak parameters, making it look random and chaotic. The active note is hard-pinned to center with `fx/fy`, which causes jarring rearrangement. There's no visual distinction between global exploration and focused local investigation.

## Design

### Global View: Tuned Force-Directed

The full graph uses an improved force-directed layout optimized for readability:

- **Stronger charge** — increase from -200 to -400 for better node spacing
- **Longer link distance** — increase from 100 to 150 so clusters spread out
- **Larger collision radius** — increase from 30 to 40 to prevent overlap
- **Soft active node centering** — when a note is active, apply a gentle `forceRadial` pulling it toward the canvas center (strength ~0.1). The node drifts toward center without being pinned, keeping the rest of the graph stable
- **Remove hard pinning** — no more `fx/fy` on the active node in global mode

### Local View: Concentric Ring Layout

When viewing a single note's neighborhood, use a radial ring layout:

- **Active note locked at center** — pinned with `fx/fy` at canvas center
- **1-hop nodes on inner ring** — direct connections constrained to a ring using `forceRadial` with the ring radius based on canvas size (~30% of min dimension)
- **2-hop nodes on outer ring** — second-degree connections on a larger ring (~60% of min dimension)
- **Force within rings** — nodes are free to spread along their ring via charge and collision forces, preventing overlap while maintaining the ring constraint
- **No visible ring guides** — the spatial positioning alone communicates hop distance
- **Cross-links rendered** — edges between nodes on the same ring are visible
- **2-hop neighborhood** — local mode shows 2 hops from active note (currently shows only 1 hop)

### Mode Transitions

When switching between global and local mode (or when the active note changes), the simulation reheats with alpha ~0.5 so nodes animate smoothly to their new positions. No instant teleporting.

## Changes

| File | Change |
|------|--------|
| `packages/client/src/components/Graph/graphConfig.ts` | New force parameters for both modes, ring radius ratios |
| `packages/client/src/components/Graph/useD3Graph.ts` | Add `forceRadial` for local mode rings and global soft centering, remove `fx/fy` pinning in global mode, expand local mode to 2-hop neighborhood, smooth mode transitions |

### Mobile Parity

The mobile app (`packages/mobile/app/(app)/(tabs)/graph.tsx`) renders its own graph via a WebView with inline canvas/D3. It must use the same layout logic:

- Same force parameters and ring layout for local mode
- Same soft centering for global mode
- Ring radii scale to the smaller mobile canvas dimensions
- The mobile graph currently defaults to local mode when an active note is set — this stays the same

Both web and mobile must produce the same visual layout behavior.

## Not Changing

- Canvas rendering approach (stays 2D canvas)
- Node styling/colors (green active, purple default, orange shared, star shapes)
- Zoom/pan behavior
- Mobile graph overlay structure
- Graph data fetching or API
