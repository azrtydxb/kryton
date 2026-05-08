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
