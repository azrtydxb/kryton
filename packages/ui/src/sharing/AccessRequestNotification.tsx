import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "../lib/utils";

export interface AccessRequestNotificationProps {
  /** Number of pending access requests */
  count: number;
  onClick: () => void;
  className?: string;
}

/**
 * A compact badge/button that indicates pending access requests.
 * Intended for use in toolbars or sidebars to open the AccessRequestList.
 */
export function AccessRequestNotification({
  count,
  onClick,
  className,
}: AccessRequestNotificationProps) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg",
        "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300",
        "hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors",
        className,
      )}
      aria-label={`${count} pending access request${count !== 1 ? "s" : ""}`}
    >
      <Bell size={13} />
      <span>
        {count} access request{count !== 1 ? "s" : ""}
      </span>
      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
}
