// packages/ui/src/graph/view/SkiaPainter.native.ts
import {
  Skia,
  FontStyle,
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

  function applyFill(style: ScenePainterStyle, fn: (p: SkPaint) => void) {
    if (!style.fill) return;
    fillPaint.setColor(Skia.Color(style.fill));
    fillPaint.setAlphaf(style.alpha ?? 1);
    fn(fillPaint);
  }
  function applyStroke(style: ScenePainterStyle, fn: (p: SkPaint) => void) {
    if (!style.stroke) return;
    strokePaint.setColor(Skia.Color(style.stroke));
    strokePaint.setStrokeWidth(style.strokeWidth ?? 1);
    strokePaint.setAlphaf(style.alpha ?? 1);
    fn(strokePaint);
  }

  function makeFont(fontSize: number, fontFamily: string) {
    const typeface = Skia.FontMgr.System().matchFamilyStyle(fontFamily, FontStyle.Normal);
    return Skia.Font(typeface, fontSize);
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
      const font = makeFont(fontSize, fontFamily);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(color));
      const width = font.getTextWidth(text);
      const dx = align === "center" ? -width / 2 : align === "right" ? -width : 0;
      canvas.drawText(text, x + dx, y + fontSize, paint, font);
    },
    measureText(text, fontSize, fontFamily) {
      const font = makeFont(fontSize, fontFamily);
      return font.getTextWidth(text);
    },
  };
}
