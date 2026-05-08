// packages/ui/src/graph/view/hitTest.ts
interface HitNode { id: string; x: number; y: number }

export interface HitTest {
  test(x: number, y: number): string | null;
  rebuild(nodes: HitNode[]): void;
}

const CELL = 64;

export function createHitTest(initial: HitNode[], radius: number): HitTest {
  let buckets = new Map<string, HitNode[]>();
  const r2 = radius * radius;

  function key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  function build(nodes: HitNode[]) {
    buckets = new Map();
    for (const n of nodes) {
      const cx = Math.floor(n.x / CELL);
      const cy = Math.floor(n.y / CELL);
      const k = key(cx, cy);
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(n);
    }
  }

  build(initial);

  return {
    test(x, y) {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      let best: { id: string; d2: number } | null = null;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(key(cx + dx, cy + dy));
          if (!arr) continue;
          for (const n of arr) {
            const ddx = n.x - x;
            const ddy = n.y - y;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 <= r2 && (!best || d2 < best.d2)) best = { id: n.id, d2 };
          }
        }
      }
      return best ? best.id : null;
    },
    rebuild(nodes) {
      build(nodes);
    },
  };
}
