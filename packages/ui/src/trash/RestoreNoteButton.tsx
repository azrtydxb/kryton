import * as React from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "../lib/utils";

export interface RestoreNoteButtonProps {
  notePath: string;
  disabled?: boolean;
  onRestore: (path: string) => Promise<void> | void;
  className?: string;
}

/**
 * Standalone restore button for a single trashed note.
 * Useful when embedding a restore affordance outside of TrashList.
 */
export function RestoreNoteButton({
  notePath,
  disabled,
  onRestore,
  className,
}: RestoreNoteButtonProps) {
  const displayName =
    notePath.split("/").pop()?.replace(/\.md$/, "") || notePath;

  return (
    <button
      type="button"
      onClick={() => onRestore(notePath)}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md",
        "text-green-600 dark:text-green-400",
        "hover:bg-green-50 dark:hover:bg-green-900/20",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "transition-colors",
        className,
      )}
      aria-label={`Restore ${displayName}`}
    >
      <RotateCcw size={13} />
      Restore
    </button>
  );
}
