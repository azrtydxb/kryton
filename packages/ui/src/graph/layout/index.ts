import type { LayoutHandle, LayoutInput } from "./types";
import { createForceLayout } from "./forceLayout";
import { createLocalLayout } from "./localLayout";

export type { LayoutHandle, LayoutInput, LayoutMode, NodePosition } from "./types";
export { createForceLayout } from "./forceLayout";
export { createLocalLayout } from "./localLayout";

export function createLayout(input: LayoutInput): LayoutHandle {
  return input.mode === "local" ? createLocalLayout(input) : createForceLayout(input);
}
