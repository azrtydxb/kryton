import * as React from "react";
import { useState } from "react";
import { Check, XCircle, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import type { SharePermission } from "./ShareInviteForm";

export interface AccessRequest {
  id: string;
  requesterUserId: string;
  requesterName?: string;
  requesterEmail?: string;
  notePath: string;
  status: string;
  createdAt: string;
}

export interface AccessRequestListProps {
  requests: AccessRequest[];
  loading?: boolean;
  respondingIds?: Set<string>;
  onApprove: (id: string, permission: SharePermission) => Promise<void> | void;
  onDeny: (id: string) => Promise<void> | void;
  className?: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function AccessRequestList({
  requests,
  loading,
  respondingIds = new Set(),
  onApprove,
  onDeny,
  className,
}: AccessRequestListProps) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [selectedPermission, setSelectedPermission] =
    useState<SharePermission>("read");

  if (loading) {
    return (
      <p className={cn("text-xs text-gray-400 py-2", className)}>
        Loading...
      </p>
    );
  }

  if (requests.length === 0) {
    return (
      <p className={cn("text-xs text-gray-400 dark:text-gray-500 py-2", className)}>
        No pending requests
      </p>
    );
  }

  return (
    <div className={cn("space-y-2 max-h-80 overflow-y-auto", className)}>
      {requests.map((req) => (
        <div
          key={req.id}
          className="rounded-lg border dark:border-surface-600 p-3 space-y-2"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500 text-sm font-semibold shrink-0">
              {(req.requesterName || req.requesterEmail || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {req.requesterName ||
                  req.requesterEmail ||
                  req.requesterUserId}
              </p>
              {req.requesterName && req.requesterEmail && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {req.requesterEmail}
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {req.notePath}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {formatDate(req.createdAt)}
              </p>
            </div>
          </div>

          {approvingId === req.id ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Permission:
              </span>
              <div className="relative">
                <select
                  value={selectedPermission}
                  onChange={(e) =>
                    setSelectedPermission(e.target.value as SharePermission)
                  }
                  className="appearance-none pl-2 pr-7 py-1 text-xs rounded-md border dark:border-surface-600 bg-transparent outline-none focus:border-violet-500 cursor-pointer"
                >
                  <option value="read">Read</option>
                  <option value="readwrite">Read-Write</option>
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  onApprove(req.id, selectedPermission);
                  setApprovingId(null);
                }}
                disabled={respondingIds.has(req.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check size={12} />
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setApprovingId(null)}
                className="px-2 py-1 text-xs font-medium rounded-md text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setApprovingId(req.id);
                  setSelectedPermission("read");
                }}
                disabled={respondingIds.has(req.id)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check size={12} />
                Approve
              </button>
              <button
                type="button"
                onClick={() => onDeny(req.id)}
                disabled={respondingIds.has(req.id)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <XCircle size={12} />
                Deny
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
