import * as React from "react";
import { useRef, useCallback, useEffect } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/utils";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  loading?: boolean;
  inputRef?: React.MutableRefObject<HTMLInputElement | undefined>;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  onKeyDown,
  onFocus,
  placeholder = "Search notes...",
  loading = false,
  inputRef: externalRef,
  className,
}: SearchInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (externalRef && internalRef.current) {
      externalRef.current = internalRef.current;
    }
  }, [externalRef]);

  const handleClear = useCallback(() => {
    onChange("");
    internalRef.current?.focus();
  }, [onChange]);

  return (
    <div className={cn("relative", className)}>
      <Search
        size={15}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        ref={internalRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        className={cn(
          "w-full bg-surface-800 border-0 rounded-md pl-8 py-1.5 text-sm text-gray-100",
          "placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-shadow",
          value ? "pr-8" : "pr-3",
        )}
        aria-label="Search"
      />
      {loading && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          …
        </span>
      )}
      {!loading && value && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
