/**
 * Platform-aware shortcut formatting. Single source of truth so every label,
 * tooltip, and kbd badge renders the right modifier glyph for the OS:
 *
 *   isMac → '⌘', '⇧', '⌥', '⌃'   (Mac kbd glyphs, no separator)
 *   else  → 'Ctrl', 'Shift', 'Alt' (Windows/Linux, '+'-joined)
 *
 * The keyboard *bindings* themselves work cross-platform — handlers use
 * `e.metaKey || e.ctrlKey`. Only the human-readable text needs to adapt.
 */

export const isMac =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

/** Primary modifier — Cmd on mac, Ctrl elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl";

export type ShortcutPart =
  | "mod"   // ⌘ / Ctrl
  | "shift" // ⇧ / Shift
  | "alt"   // ⌥ / Alt
  | "ctrl"  // ⌃ / Ctrl (literal control on mac, where you also might want Cmd)
  | string; // any literal key, e.g. 'N', 'B', '/'

/**
 * Render a shortcut as a single label.
 *   formatShortcut(['mod', 'B'])           → '⌘B'         (mac)  | 'Ctrl+B'         (other)
 *   formatShortcut(['mod', 'shift', 'S'])  → '⌘⇧S'        (mac)  | 'Ctrl+Shift+S'   (other)
 */
export function formatShortcut(parts: ShortcutPart[]): string {
  const sep = isMac ? "" : "+";
  return parts
    .map((p) => {
      switch (p) {
        case "mod": return isMac ? "⌘" : "Ctrl";
        case "shift": return isMac ? "⇧" : "Shift";
        case "alt": return isMac ? "⌥" : "Alt";
        case "ctrl": return isMac ? "⌃" : "Ctrl";
        default: return p;
      }
    })
    .join(sep);
}
