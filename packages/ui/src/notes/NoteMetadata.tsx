import * as React from "react";
import { Clock, Tag, Hash } from "lucide-react";
import { cn } from "../lib/utils";
import type { NoteData } from "../data/types";

export interface NoteMetadataProps {
  note: NoteData;
  /** Formatter for the modifiedAt timestamp. Defaults to locale date string. */
  formatDate?: (timestamp: number) => string;
  className?: string;
}

function defaultFormatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function NoteMetadata({ note, formatDate = defaultFormatDate, className }: NoteMetadataProps) {
  const tags = React.useMemo(() => {
    try {
      return JSON.parse(note.tags) as string[];
    } catch {
      return [] as string[];
    }
  }, [note.tags]);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-4 py-3 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Hash size={12} className="shrink-0 text-gray-400" aria-hidden="true" />
        <span className="font-medium text-gray-600 dark:text-gray-300">Path:</span>
        <span className="truncate">{note.path}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Clock size={12} className="shrink-0 text-gray-400" aria-hidden="true" />
        <span className="font-medium text-gray-600 dark:text-gray-300">Modified:</span>
        <span>{formatDate(note.modifiedAt)}</span>
      </div>
      {tags.length > 0 && (
        <div className="flex items-start gap-1.5">
          <Tag size={12} className="shrink-0 text-gray-400 mt-0.5" aria-hidden="true" />
          <span className="font-medium text-gray-600 dark:text-gray-300 shrink-0">Tags:</span>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-block px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
