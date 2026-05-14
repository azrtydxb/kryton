import * as React from "react";
import { useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Share2 } from "lucide-react";
import { ShareInviteForm } from "./ShareInviteForm";
import { ShareList } from "./ShareList";
import type { FoundUser, SharePermission } from "./ShareInviteForm";
import type { ShareEntry } from "./ShareList";

export interface ShareDialogProps {
  notePath: string;
  isFolder?: boolean;
  shares: ShareEntry[];
  loadingShares?: boolean;
  onClose: () => void;
  onSearchUser: (email: string) => Promise<FoundUser>;
  onInvite: (params: {
    userId: string;
    permission: SharePermission;
    shareAsFolder: boolean;
  }) => Promise<void>;
  onTogglePermission: (share: ShareEntry) => Promise<void> | void;
  onRevoke: (id: string) => Promise<void> | void;
}

export function ShareDialog({
  notePath,
  isFolder,
  shares,
  loadingShares,
  onClose,
  onSearchUser,
  onInvite,
  onTogglePermission,
  onRevoke,
}: ShareDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose],
  );

  const existingSharedUserIds = shares.map((s) => s.sharedWithUserId);

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.6)" }}
      onClick={handleOverlayClick}
    >
      {/*
        Inline styles using the project's token system (var(--bg-1),
        var(--line), …). Tailwind's `dark:bg-surface-900` previously
        used a colour that isn't declared in the theme — in dark mode
        the dialog fell through to the `bg-white` base, producing the
        bright white modal on a black UI.
      */}
      <div
        ref={dialogRef}
        className="w-full max-w-md mx-4 overflow-hidden"
        style={{
          background: "var(--bg-1)",
          color: "var(--fg)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <div className="flex items-center gap-2">
            <Share2 size={18} style={{ color: "var(--accent)" }} />
            <h2 className="text-sm font-semibold truncate">
              Share {notePath}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: 4,
              borderRadius: 4,
              color: "var(--fg-3)",
              background: "transparent",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <ShareInviteForm
            notePath={notePath}
            isFolder={isFolder}
            existingSharedUserIds={existingSharedUserIds}
            onSearchUser={onSearchUser}
            onInvite={onInvite}
          />
          <ShareList
            shares={shares}
            loading={loadingShares}
            onTogglePermission={onTogglePermission}
            onRevoke={onRevoke}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
