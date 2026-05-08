// packages/ui/src/editor/state/document.ts
export interface Line {
  number: number;
  from: number;
  to: number;
  text: string;
}

export interface Document {
  readonly text: string;
  readonly length: number;
  slice(from: number, to: number): string;
  replace(from: number, to: number, insert: string): Document;
  lineAt(offset: number): Line;
}

export function createDocument(text: string): Document {
  return new DocumentImpl(text);
}

class DocumentImpl implements Document {
  constructor(public readonly text: string) {}
  get length(): number { return this.text.length; }

  slice(from: number, to: number): string {
    if (from < 0 || to > this.text.length || from > to) {
      throw new RangeError(`slice(${from}, ${to}) out of bounds for length ${this.text.length}`);
    }
    return this.text.slice(from, to);
  }

  replace(from: number, to: number, insert: string): Document {
    if (from < 0 || to > this.text.length || from > to) {
      throw new RangeError(`replace(${from}, ${to}) out of bounds`);
    }
    return new DocumentImpl(this.text.slice(0, from) + insert + this.text.slice(to));
  }

  lineAt(offset: number): Line {
    if (offset < 0 || offset > this.text.length) {
      throw new RangeError(`lineAt(${offset}) out of bounds`);
    }
    let lineStart = 0, lineNumber = 1;
    for (let i = 0; i < offset; i++) {
      if (this.text.charCodeAt(i) === 10 /* \n */) {
        lineStart = i + 1;
        lineNumber++;
      }
    }
    let lineEnd = lineStart;
    while (lineEnd < this.text.length && this.text.charCodeAt(lineEnd) !== 10) lineEnd++;
    return { number: lineNumber, from: lineStart, to: lineEnd, text: this.text.slice(lineStart, lineEnd) };
  }
}
