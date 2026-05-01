import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useDebouncedCallback } from "use-debounce";
import { SearchInput } from "./SearchInput";
import { SearchResults, type SearchResultItem } from "./SearchResults";
import { cn } from "../lib/utils";

export interface FullTextSearchScreenProps {
  /** Called with the adapter-resolved path when a result is selected. */
  onSelect: (path: string) => void;
  /**
   * Async function that performs the full-text search. The component is
   * data-agnostic — the caller bridges to the actual search API.
   */
  onSearch: (query: string) => Promise<SearchResultItem[]>;
  placeholder?: string;
  /** External ref forwarded to the underlying <input>. */
  inputRef?: React.MutableRefObject<HTMLInputElement | undefined>;
  className?: string;
}

/**
 * Full-text search widget with a debounced input and a portal-rendered
 * dropdown. Replaces the client-side `SearchBar` component, swapping the
 * `api.search` call for the `onSearch` prop.
 */
export function FullTextSearchScreen({
  onSelect,
  onSearch,
  placeholder = "Search notes… (Ctrl+K)",
  inputRef: externalRef,
  className,
}: FullTextSearchScreenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const updateDropdownPos = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      updateDropdownPos();
      window.addEventListener("resize", updateDropdownPos);
      window.addEventListener("scroll", updateDropdownPos, true);
      return () => {
        window.removeEventListener("resize", updateDropdownPos);
        window.removeEventListener("scroll", updateDropdownPos, true);
      };
    }
  }, [open, updateDropdownPos]);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.trim().length === 0) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const res = await onSearch(q);
        setResults(res);
        setOpen(true);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [onSearch],
  );

  const debouncedSearch = useDebouncedCallback((value: string) => {
    doSearch(value);
  }, 200);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      debouncedSearch(value);
    },
    [debouncedSearch],
  );

  const handleSelect = useCallback(
    (result: SearchResultItem) => {
      const path =
        result.isShared && result.ownerUserId
          ? `shared:${result.ownerUserId}:${result.path}`
          : result.path;
      onSelect(path);
      setQuery("");
      setResults([]);
      setOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[selectedIndex];
        if (item) handleSelect(item);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [open, results, selectedIndex, handleSelect],
  );

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <SearchInput
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        loading={loading}
        inputRef={externalRef}
      />

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 99999,
            }}
            className="bg-white dark:bg-gray-800 border rounded-lg shadow-lg overflow-hidden"
          >
            <SearchResults
              results={results}
              loading={loading}
              query={query}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              onHover={setSelectedIndex}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
