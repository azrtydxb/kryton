import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "../lib/utils";

export interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  group?: string;
}

export interface CommandPaletteProps {
  /** Whether the palette is visible. */
  open: boolean;
  /** Called when the palette should be closed. */
  onClose: () => void;
  /** Flat list of available actions. */
  actions: CommandAction[];
  /** Optional placeholder for the search input. */
  placeholder?: string;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

const LISTBOX_ID = "command-palette-listbox";

/**
 * CommandPalette — ⌘K modal with fuzzy-filtered action list.
 *
 * Keyboard navigation: ArrowUp / ArrowDown to move, Enter to select,
 * Escape to close.
 *
 * Consumers control open state and supply the action registry via `actions`.
 */
export function CommandPalette({
  open,
  onClose,
  actions,
  placeholder = "Search actions…",
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state whenever palette is opened
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus with a microtask to ensure the DOM is painted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return actions;
    return actions.filter((a) => fuzzyMatch(query, a.label) || fuzzyMatch(query, a.group ?? ""));
  }, [actions, query]);

  // Reset selection when results change
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        filtered[selectedIndex]?.onSelect();
        onClose();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onClose],
  );

  if (!open) return null;

  // Group actions
  const groups = React.useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    for (const action of filtered) {
      const g = action.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(action);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const activeOptionId =
    filtered.length > 0 ? `cp-option-${selectedIndex}` : undefined;

  // Flat index → action for aria-activedescendant mapping
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3">
          <Search
            size={16}
            className="shrink-0 text-gray-400"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Results */}
        <div
          id={LISTBOX_ID}
          role="listbox"
          className="max-h-80 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-gray-400">
              No actions found
            </div>
          ) : (
            (() => {
              let flatIndex = 0;
              return groups.map(([groupName, groupActions]) => (
                <div key={groupName}>
                  {groupName && (
                    <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {groupName}
                    </div>
                  )}
                  {groupActions.map((action) => {
                    const idx = flatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={action.id}
                        id={`cp-option-${idx}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          action.onSelect();
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300"
                            : "hover:bg-gray-50 dark:hover:bg-gray-700/50",
                        )}
                      >
                        <span className="truncate">{action.label}</span>
                        {action.shortcut && (
                          <kbd className="shrink-0 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            {action.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>
      </div>
    </div>
  );
}
