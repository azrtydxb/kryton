import * as React from "react";
import { Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import type { SharePermission } from "./ShareInviteForm";

export interface ShareEntry {
  id: string;
  sharedWithUserId: string;
  sharedWithEmail?: string;
  sharedWithName?: string;
  permission: SharePermission;
}

export interface ShareListProps {
  shares: ShareEntry[];
  loading?: boolean;
  onTogglePermission: (share: ShareEntry) => Promise<void> | void;
  onRevoke: (id: string) => Promise<void> | void;
  className?: string;
}

export function ShareList({
  shares,
  loading,
  onTogglePermission,
  onRevoke,
  className,
}: ShareListProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        Current shares
      </label>
      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading...</p>
      ) : shares.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
          Not shared with anyone yet.
        </p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {shares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50 dark:bg-surface-800"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">
                  {share.sharedWithEmail || share.sharedWithUserId}
                </p>
                {share.sharedWithName && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {share.sharedWithName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onTogglePermission(share)}
                className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded-full transition-colors cursor-pointer",
                  share.permission === "readwrite"
                    ? "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30"
                    : "bg-gray-200 dark:bg-surface-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-surface-600",
                )}
                title="Click to toggle permission"
              >
                {share.permission === "readwrite" ? "Read-Write" : "Read"}
              </button>
              <button
                type="button"
                onClick={() => onRevoke(share.id)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                title="Revoke access"
                aria-label="Revoke access"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
