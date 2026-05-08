// packages/ui/src/graph/gestures/useViewport.native.ts
import { useMemo } from "react";
import { Gesture, type SimultaneousGesture } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { GRAPH_CONFIG } from "../graphConfig";

export interface NativeViewport {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  k: SharedValue<number>;
  gesture: SimultaneousGesture;
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
