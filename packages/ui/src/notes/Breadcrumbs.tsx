import * as React from "react";
import { cn } from "../lib/utils";

export interface BreadcrumbsProps {
  /** e.g. "Projects/Kryton/Tasks.md" */
  path: string;
  onFolderClick: (folderPath: string) => void;
  className?: string;
}

export function Breadcrumbs({ path, onFolderClick, className }: BreadcrumbsProps) {
  const segments = path.split("/");

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const folderPath = segments.slice(0, index + 1).join("/");

        if (isLast) {
          return (
            <span key={folderPath} className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {segment}
            </span>
          );
        }

        return (
          <span key={folderPath} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onFolderClick(folderPath)}
              className="text-xs text-gray-400 hover:text-violet-400 cursor-pointer transition-colors"
            >
              {segment}
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-600 select-none">/</span>
          </span>
        );
      })}
    </div>
  );
}
