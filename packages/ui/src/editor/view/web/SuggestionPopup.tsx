// packages/ui/src/editor/view/web/SuggestionPopup.tsx
//
// Absolute-positioned popup rendered by EditorView while a suggestion
// trigger is live. Keyboard navigation (Up/Down/Enter/Esc) is handled by
// the parent — this component only renders.

import * as React from "react";
import type { Suggestion } from "../../state/plugins";

export interface SuggestionPopupProps {
  items: readonly Suggestion[];
  activeIndex: number;
  top: number;
  left: number;
  onPick: (item: Suggestion) => void;
  onHover: (index: number) => void;
}

export function SuggestionPopup({
  items,
  activeIndex,
  top,
  left,
  onPick,
  onHover,
}: SuggestionPopupProps) {
  if (items.length === 0) return null;
  return (
    <div
      data-suggestion-popup=""
      role="listbox"
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 1000,
        minWidth: 200,
        maxWidth: 320,
        maxHeight: 240,
        overflowY: "auto",
        background: "var(--popover, #1f2937)",
        color: "var(--popover-foreground, #f3f4f6)",
        border: "1px solid var(--border, #374151)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        fontSize: 13,
        padding: 4,
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === activeIndex}
          data-active={i === activeIndex || undefined}
          onMouseDown={(e) => {
            // Prevent the editor losing selection focus before we apply.
            e.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover(i)}
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            cursor: "pointer",
            background:
              i === activeIndex
                ? "var(--accent, #4f46e5)"
                : "transparent",
            color: i === activeIndex ? "#fff" : undefined,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
