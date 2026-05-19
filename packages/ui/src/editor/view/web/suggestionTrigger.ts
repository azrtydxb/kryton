// packages/ui/src/editor/view/web/suggestionTrigger.ts
//
// Pure helpers for detecting / updating the editor's suggestion trigger
// state. The host editor watches input events; this module decides whether
// the caret has just opened a slash/wikilink/tag trigger and, on every
// subsequent input, recomputes the active trigger's query or closes it.
//
// No DOM access — everything operates on the doc string + caret offset.

import type { SuggestionTrigger } from "../../state/plugins";

export type TriggerKind = SuggestionTrigger["kind"];

/**
 * Detect whether typing `inserted` at `caretBefore` in `docBefore` opens a
 * new suggestion trigger. Returns null when no trigger fires.
 *
 * Trigger rules:
 *  - "/"  at start-of-line OR after whitespace → slash command
 *  - "#"  at start-of-line OR after whitespace → tag
 *  - "[" immediately after another "[" → wikilink (the trigger anchor is
 *    the inner "[", `from` points at the char AFTER the "[[" pair so a
 *    plugin's `insert` replaces just the user-typed query, not the "[[")
 */
export function detectTriggerOnInsert(
  docBefore: string,
  caretBefore: number,
  inserted: string,
): SuggestionTrigger | null {
  if (inserted.length !== 1) return null;
  const ch = inserted;
  const prev = caretBefore > 0 ? docBefore[caretBefore - 1] : "";
  const atLineStart = caretBefore === 0 || prev === "\n";
  const afterWs = prev === " " || prev === "\t";

  if (ch === "/" && (atLineStart || afterWs)) {
    const from = caretBefore + 1; // position after the "/" itself
    return { kind: "slash", from, caret: from, query: "" };
  }
  if (ch === "#" && (atLineStart || afterWs)) {
    const from = caretBefore + 1;
    return { kind: "tag", from, caret: from, query: "" };
  }
  if (ch === "[" && prev === "[") {
    const from = caretBefore + 1; // position after the second "["
    return { kind: "wikilink", from, caret: from, query: "" };
  }
  return null;
}

/**
 * Compute the next trigger state given the current trigger and the latest
 * caret + doc. Returns:
 *  - the updated trigger (caret/query refreshed) when the trigger is still
 *    live (caret remains at-or-after `from`, query has no terminator),
 *  - null when the trigger should close (caret moved before `from`, the
 *    query contains a newline, a whitespace was typed after the trigger
 *    char for slash/tag, or the wikilink was closed with "]").
 */
export function refreshTrigger(
  trigger: SuggestionTrigger,
  doc: string,
  caret: number,
): SuggestionTrigger | null {
  if (caret < trigger.from) return null;
  if (caret > doc.length) return null;
  const query = doc.slice(trigger.from, caret);
  // Hard terminators: any newline closes every trigger.
  if (query.includes("\n")) return null;
  if (trigger.kind === "slash" || trigger.kind === "tag") {
    // Whitespace after the trigger char closes a slash/tag suggestion.
    if (/\s/.test(query)) return null;
  } else if (trigger.kind === "wikilink") {
    // A closing "]" terminates the wikilink trigger.
    if (query.includes("]")) return null;
  }
  return { ...trigger, caret, query };
}
