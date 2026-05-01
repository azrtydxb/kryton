import * as React from "react";
import { Breadcrumbs } from "./Breadcrumbs";
import { cn } from "../lib/utils";

export interface NoteHeaderProps {
  /** Full note path, e.g. "Projects/Kryton/Tasks.md" */
  path: string;
  /** Called when a folder segment is clicked in the breadcrumb. */
  onFolderClick: (folderPath: string) => void;
  /** Optional slot for additional actions (e.g. share button, more menu). */
  actions?: React.ReactNode;
  className?: string;
}

export function NoteHeader({ path, onFolderClick, actions, className }: NoteHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-h-[40px]",
        className,
      )}
    >
      <Breadcrumbs path={path} onFolderClick={onFolderClick} />
      {actions && <div className="flex items-center gap-1 ml-2">{actions}</div>}
    </div>
  );
}
