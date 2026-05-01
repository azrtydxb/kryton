import * as React from "react";
import { useState } from "react";
import { ChevronRight, ArrowUpLeft } from "lucide-react";
import { cn } from "../lib/utils";

export interface BacklinkItem {
  path: string;
  title: string;
}

export interface BacklinksPanelProps {
  /** Backlinks to display. The caller is responsible for fetching / deriving these. */
  backlinks: BacklinkItem[];
  loading?: boolean;
  onNoteSelect: (path: string) => void;
  /** Start in expanded state. Defaults to false. */
  defaultExpanded?: boolean;
  className?: string;
}

export function BacklinksPanel({
  backlinks,
  loading = false,
  onNoteSelect,
  defaultExpanded = false,
  className,
}: BacklinksPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("border-t bg-gray-50/50 dark:bg-surface-900/50", className)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronRight
          size={14}
          className={cn(
            "transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <ArrowUpLeft size={14} />
        Backlinks
        {backlinks.length > 0 && (
          <span className="ml-auto text-xs font-normal bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 py-0.5">
            {backlinks.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {loading ? (
            <p className="text-xs text-gray-400 py-1">Loading…</p>
          ) : backlinks.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">No backlinks found</p>
          ) : (
            <ul className="space-y-0.5">
              {backlinks.map((link) => (
                <li key={link.path}>
                  <button
                    onClick={() => onNoteSelect(link.path)}
                    className="text-sm text-violet-500 dark:text-violet-400 hover:underline truncate block w-full text-left py-0.5"
                    title={link.path}
                  >
                    {link.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
