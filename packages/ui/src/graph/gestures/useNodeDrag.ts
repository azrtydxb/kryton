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
