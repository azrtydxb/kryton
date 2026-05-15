import * as React from "react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FileText, Search } from "lucide-react";

export interface NoteEntry {
  /** File path (e.g. "folder/note.md"). */
  path: string;
  /** Display name (without extension). */
  name: string;
}

export interface NoteQuickSwitcherProps {
  /** Flat list of all available notes. */
  notes: NoteEntry[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

const LISTBOX_ID = "note-quick-switcher-listbox";

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * NoteQuickSwitcher — fuzzy note-file picker.
 *
 * Differs from CommandPalette in that it is specifically for note navigation,
 * not arbitrary command dispatch.
 *
 * Renders as a modal overlay; the caller controls mount/unmount.
 */
export function NoteQuickSwitcher({
  notes,
  onSelect,
  onClose,
}: NoteQuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset selection when query changes (derived-from-input pattern)
  if (prevQuery !== query) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  const filtered = useMemo(
    () =>
      query.trim()
        ? notes.filter(
            (f) => fuzzyMatch(query, f.name) || fuzzyMatch(query, f.path),
          )
        : notes,
    [notes, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        const selected = filtered[selectedIndex];
        if (selected) {
          onSelect(selected.path);
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  const activeOptionId =
    filtered.length > 0 ? `qs-option-${selectedIndex}` : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick note switcher"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 border-b">
          <Search
            size={16}
            className="text-gray-400 flex-shrink-0"
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
            placeholder="Type to search notes…"
            className="w-full py-3 bg-transparent text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Results */}
        <div
          id={LISTBOX_ID}
          role="listbox"
          className="max-h-72 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              No notes found
            </div>
          ) : (
            filtered.map((file, idx) => (
              <button
                key={file.path}
                id={`qs-option-${idx}`}
                role="option"
                aria-selected={idx === selectedIndex}
                type="button"
                onClick={() => {
                  onSelect(file.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  idx === selectedIndex
                    ? "bg-violet-50 dark:bg-violet-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                }`}
              >
                <FileText
                  size={15}
                  className="text-gray-400 flex-shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {file.path}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
