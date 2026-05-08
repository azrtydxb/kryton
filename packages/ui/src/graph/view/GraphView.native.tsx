// packages/ui/src/graph/view/GraphView.native.tsx
import * as React from "react";
import { View } from "react-native";
import {
  Canvas,
  useCanvasRef,
} from "@shopify/react-native-skia";
import { useFrameCallback } from "react-native-reanimated";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvas = (canvasRef.current as any)?.getRecordingCanvas?.();
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
