// packages/ui/src/editor/state/decorations.ts
import type { Tree } from "@lezer/common";
import type { DecorationSpec, DecorationKind } from "./types";

const KIND_BY_NODE: Record<string, DecorationKind> = {
  ATXHeading1: "heading-1",
  ATXHeading2: "heading-2",
  ATXHeading3: "heading-3",
  ATXHeading4: "heading-4",
  ATXHeading5: "heading-5",
  ATXHeading6: "heading-6",
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strikethrough",
  InlineCode: "code-inline",
  FencedCode: "code-block",
  CodeBlock: "code-block",
  Link: "link",
  Blockquote: "blockquote",
  ListItem: "list-item",
  HorizontalRule: "horizontal-rule",
};

// Lezer mark nodes: structural delimiters that should get a distinct
// colour while leaving the construct's content alone. Per the prototype
// (editor.jsx MdLine) the heading `#`, list `-`, and quote `>` are
// highlighted as separate spans. Emphasis (`**`) and inline-code
// backticks are intentionally NOT split out — those tokens render with
// the same colour as the bold / italic / code content so the whole
// marker-plus-text reads as one unit. WikiLinkMark also stays inside the
// surrounding wikilink span for the same reason.
const MARK_BY_NODE: Record<string, DecorationKind> = {
  HeaderMark: "mark-header",
  ListMark: "mark-list",
  QuoteMark: "mark-quote",
  LinkMark: "mark-link",
  URL: "mark-link-url",
};

export function emitDecorations(text: string, tree: Tree): DecorationSpec[] {
  const out: DecorationSpec[] = [];
  tree.iterate({
    enter: (node) => {
      const kind = KIND_BY_NODE[node.name];
      if (kind) {
        out.push({ from: node.from, to: node.to, kind });
        return;
      }
      const mark = MARK_BY_NODE[node.name];
      if (mark) {
        out.push({ from: node.from, to: node.to, kind: mark });
        return;
      }
      if (node.name === "WikiLink") {
        // Target sits between the [[ and ]] marks.
        const inner = text.slice(node.from + 2, node.to - 2);
        const target = inner.split("|")[0]!.trim();
        out.push({ from: node.from, to: node.to, kind: "wikilink", attrs: { target } });
        return;
      }
      if (node.name === "Hashtag") {
        out.push({ from: node.from, to: node.to, kind: "tag" });
        return;
      }
      if (node.name === "TaskMarker") {
        const marker = text.slice(node.from, node.to);
        out.push({
          from: node.from,
          to: node.to,
          kind: marker.includes("x") || marker.includes("X") ? "task-checked" : "task-unchecked",
        });
      }
    },
  });
  return out;
}
