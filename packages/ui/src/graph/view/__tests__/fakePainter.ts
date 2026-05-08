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
