import * as React from "react";
import { FileText, Share2 } from "lucide-react";
import { cn } from "../lib/utils";

export interface SearchResultItem {
  path: string;
  title: string;
  snippet?: string;
  tags: string[];
  isShared?: boolean;
  ownerUserId?: string;
}

export interface SearchResultsProps {
  results: SearchResultItem[];
  loading?: boolean;
  query?: string;
  selectedIndex?: number;
  onSelect: (result: SearchResultItem) => void;
  onHover?: (index: number) => void;
  className?: string;
}

export function SearchResults({
  results,
  loading = false,
  query = "",
  selectedIndex = 0,
  onSelect,
  onHover,
  className,
}: SearchResultsProps) {
  if (loading) {
    return (
      <div className={cn("px-3 py-2 text-sm text-gray-500", className)}>
        Searching…
      </div>
    );
  }

  if (results.length === 0 && query.trim()) {
    return (
      <div className={cn("px-3 py-2 text-sm text-gray-500", className)}>
        No results found
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className={cn("overflow-y-auto max-h-80", className)}>
      {results.map((result, idx) => (
        <button
          key={result.path}
          onClick={() => onSelect(result)}
          onMouseEnter={() => onHover?.(idx)}
          className={cn(
            "w-full text-left px-3 py-2 flex items-start gap-2 transition-colors",
            idx === selectedIndex
              ? "bg-violet-50 dark:bg-violet-900/20"
              : "hover:bg-gray-50 dark:hover:bg-gray-700/50",
          )}
        >
          {result.isShared ? (
            <Share2 size={15} className="text-orange-400 mt-0.5 flex-shrink-0" />
          ) : (
            <FileText size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{result.title}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {result.path}
            </div>
            {result.snippet && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">
                {result.snippet}
              </div>
            )}
            {result.tags.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {result.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
