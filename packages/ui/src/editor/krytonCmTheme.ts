/**
 * krytonCmTheme — CodeMirror theme + markdown highlight style that mirrors
 * design_handoff/prototype/app/editor.jsx MdLine / MdInline.
 *
 *   `#` heading marker     →  var(--accent-2) (cyan)
 *   heading text           →  var(--fg), bold
 *   list marker `-` / `*`  →  var(--accent)
 *   **bold** (with markers)→  var(--accent-warn) (amber)
 *   `code`                 →  var(--code-fg) on var(--code-bg)
 *   [[wiki-links]] / urls  →  var(--accent), dashed underline
 *   plain text             →  var(--fg-1)
 *
 * All colours read from CSS custom properties so the editor tracks the
 * user's accent + light/dark theme without rebuilding the simulation.
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Editor surface theme — fonts, padding, line numbers, selection. */
const krytonEditorTheme = EditorView.theme(
  {
    "&": {
      fontFamily: "var(--font-mono)",
      fontSize: "13.5px",
      backgroundColor: "var(--bg)",
      color: "var(--fg-1)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "22px",
    },
    ".cm-content": {
      padding: "20px 28px 200px",
      caretColor: "var(--accent)",
    },
    ".cm-focused": { outline: "none" },
    ".cm-line": {
      padding: "0",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--fg-4)",
      border: "none",
      paddingRight: "10px",
      fontSize: "11.5px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--fg-3)",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection)",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--selection)",
    },
    ".cm-tooltip": {
      background: "var(--bg-1)",
      border: "1px solid var(--line-strong)",
      borderRadius: "6px",
      color: "var(--fg-1)",
      fontSize: "12px",
      boxShadow: "var(--shadow-md)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: "var(--accent-soft)",
      color: "var(--accent)",
    },
  },
  { dark: true },
);

/** Markdown highlight style mirroring prototype/app/editor.jsx MdLine + MdInline. */
const krytonHighlight = HighlightStyle.define([
  // Heading marker (`#`) cyan; heading text bright fg + bold
  { tag: t.heading1, color: "var(--fg)", fontWeight: "600" },
  { tag: t.heading2, color: "var(--fg)", fontWeight: "600" },
  { tag: t.heading3, color: "var(--fg)", fontWeight: "600" },
  { tag: t.heading4, color: "var(--fg)", fontWeight: "600" },
  { tag: t.heading5, color: "var(--fg)", fontWeight: "600" },
  { tag: t.heading6, color: "var(--fg)", fontWeight: "600" },
  // The literal `#` markers in markdown headings
  { tag: t.processingInstruction, color: "var(--accent-2)" },
  // List markers (`-`, `*`, `+`, `1.`)
  { tag: t.list, color: "var(--accent)" },
  // Bold (with markers visible) — amber
  { tag: t.strong, color: "var(--accent-warn)", fontWeight: "600" },
  // Italic — keep fg-1, italic
  { tag: t.emphasis, color: "var(--fg-1)", fontStyle: "italic" },
  // Inline code & code blocks — pinkish via --code-fg
  { tag: t.monospace, color: "var(--code-fg)" },
  // Links / URLs — accent with dashed underline
  {
    tag: [t.url, t.link],
    color: "var(--accent)",
    textDecoration: "underline dashed",
    textUnderlineOffset: "3px",
  },
  // Quote lines — fg-3
  { tag: t.quote, color: "var(--fg-3)", fontStyle: "italic" },
  // Strikethrough
  { tag: t.strikethrough, color: "var(--fg-3)", textDecoration: "line-through" },
  // Comments / meta (frontmatter-ish tokens)
  { tag: [t.comment, t.meta], color: "var(--fg-4)" },
  // Default content
  { tag: t.content, color: "var(--fg-1)" },
]);

/** Bundle: theme + highlight, ready to drop into EditorState extensions. */
export const krytonCmTheme = [
  krytonEditorTheme,
  syntaxHighlighting(krytonHighlight, { fallback: true }),
];
