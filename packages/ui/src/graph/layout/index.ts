import type { LayoutHandle, LayoutInput } from "./types";
import { createForceLayout } from "./forceLayout";

export type { LayoutHandle, LayoutInput, LayoutMode, NodePosition } from "./types";
export { createForceLayout } from "./forceLayout";
export { createLocalLayout } from "./localLayout";

/**
 * Both `global` and `local` modes share the same force-directed layout —
 * they only differ in display: drawScene ghosts non-set nodes/edges in
 * local mode (see graph.jsx ~lines 53-81 for the bible's intent). Using a
 * single layout means switching mode or selecting a note never restructures
 * positions, so the cluster doesn't snap or vibrate.
 */
export function createLayout(input: LayoutInput): LayoutHandle {
  return createForceLayout(input);
}
