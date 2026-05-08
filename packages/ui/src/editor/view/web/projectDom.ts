// packages/ui/src/editor/view/web/projectDom.ts
import type { DecorationKind, DecorationSpec } from "../../state/types";

export interface DomRun {
  kind: DecorationKind | null;
  text: string;
  from: number;
  to: number;
  attrs?: Record<string, string>;
}

/**
 * Flatten the document text + decorations into a sequence of runs, where each
 * run carries at most one DecorationKind. v1 strategy: when decorations
 * overlap, the deeper (smaller-range) decoration wins on the overlap segment.
 */
export function projectDom(text: string, decorations: readonly DecorationSpec[]): DomRun[] {
  if (decorations.length === 0) return [{ kind: null, text, from: 0, to: text.length }];
  // Build a per-offset tag of "innermost decoration" by sorting decos and
  // walking left-to-right, keeping a stack of active decos sorted by length.
  const sorted = [...decorations].sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const tag: Array<DecorationSpec | null> = new Array(text.length).fill(null);
  for (const d of sorted) {
    for (let i = d.from; i < d.to; i++) {
      // Smaller (= deeper) range wins.
      const cur = tag[i];
      if (!cur || (d.to - d.from) < (cur.to - cur.from)) tag[i] = d;
    }
  }
  const runs: DomRun[] = [];
  let i = 0;
  while (i < text.length) {
    const cur = tag[i];
    let j = i + 1;
    while (j < text.length && tag[j] === cur) j++;
    runs.push({
      kind: cur?.kind ?? null,
      text: text.slice(i, j),
      from: i,
      to: j,
      attrs: cur?.attrs,
    });
    i = j;
  }
  return runs;
}
