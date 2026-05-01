import * as React from "react";

export interface KeyBinding {
  /**
   * Cross-platform key combination string. Supports:
   * - `"CmdOrCtrl+K"` → ⌘K on macOS, Ctrl+K elsewhere
   * - `"Shift+CmdOrCtrl+P"` → ⇧⌘P on macOS, Ctrl+Shift+P elsewhere
   * - Individual modifiers: `Cmd`, `Ctrl`, `Shift`, `Alt`, `Meta`
   */
  keys: string;
  handler: () => void;
  description: string;
}

export interface KeyboardShortcutsProps {
  bindings: KeyBinding[];
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Parse a `keys` string like `"CmdOrCtrl+Shift+K"` into a normalised
 * descriptor object for matching against KeyboardEvent.
 */
function parseKeys(keys: string): {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  const parts = keys.split("+").map((p) => p.trim());
  let meta = false;
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "cmdorctrl" || lower === "commandorcontrol") {
      if (IS_MAC) {
        meta = true;
      } else {
        ctrl = true;
      }
    } else if (lower === "cmd" || lower === "command" || lower === "meta") {
      meta = true;
    } else if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else {
      // Remaining token is the actual key
      key = part;
    }
  }

  return { key: key.toLowerCase(), meta, ctrl, shift, alt };
}

/**
 * KeyboardShortcuts — mounts global `keydown` listeners for a declarative
 * binding registry.
 *
 * Renders nothing — purely a side-effect component.
 *
 * Platform-correct: `"CmdOrCtrl+K"` resolves to ⌘K on macOS and Ctrl+K on
 * Windows/Linux.
 */
export function KeyboardShortcuts({ bindings }: KeyboardShortcutsProps) {
  // Keep stable reference to current bindings to avoid re-attaching listener
  // on every render.
  const bindingsRef = React.useRef(bindings);
  React.useEffect(() => {
    bindingsRef.current = bindings;
  });

  React.useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      // Skip if focus is in a text input / contenteditable (unless the handler
      // explicitly opts in via a binding description prefix "[global]").
      const tag = (e.target as HTMLElement)?.tagName ?? "";
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable;

      for (const binding of bindingsRef.current) {
        const parsed = parseKeys(binding.keys);
        const keyMatches =
          e.key.toLowerCase() === parsed.key;
        const metaMatches = e.metaKey === parsed.meta;
        const ctrlMatches = e.ctrlKey === parsed.ctrl;
        const shiftMatches = e.shiftKey === parsed.shift;
        const altMatches = e.altKey === parsed.alt;

        if (
          keyMatches &&
          metaMatches &&
          ctrlMatches &&
          shiftMatches &&
          altMatches
        ) {
          const isGlobal = binding.description.startsWith("[global]");
          if (isEditable && !isGlobal) continue;
          e.preventDefault();
          binding.handler();
        }
      }
    };

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []); // attach once; reads through bindingsRef

  return null;
}
