// packages/ui/src/editor/state/parser.ts
import { parser as baseParser } from "@lezer/markdown";
import type { MarkdownExtension } from "@lezer/markdown";
import type { Tree } from "@lezer/common";
import { TreeFragment } from "@lezer/common";

/** Wikilink Lezer extension: recognises [[Title]] and [[Title|alias]]. */
const wikilink: MarkdownExtension = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */) return -1;
        if (cx.char(pos + 1) !== 91) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const c = cx.char(end);
          if (c === 93 /* ] */ && cx.char(end + 1) === 93) {
            return cx.addElement(
              cx.elt("WikiLink", pos, end + 2, [
                cx.elt("WikiLinkMark", pos, pos + 2),
                cx.elt("WikiLinkMark", end, end + 2),
              ]),
            );
          }
          if (c === 10) return -1;
          end++;
        }
        return -1;
      },
    },
  ],
};

const md = baseParser.configure([wikilink]);

export interface MarkdownParser {
  parse(text: string): Tree;
  parseIncremental(text: string, previous: Tree): Tree;
}

export function createParser(): MarkdownParser {
  return {
    parse(text) {
      return md.parse(text);
    },
    parseIncremental(text, previous) {
      const fragments = TreeFragment.addTree(previous);
      return md.parse(text, fragments);
    },
  };
}
