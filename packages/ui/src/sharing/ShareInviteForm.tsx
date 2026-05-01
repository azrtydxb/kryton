import * as React from "react";
import { useState, useCallback } from "react";
import { Search, UserPlus, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

export type SharePermission = "read" | "readwrite";

export interface FoundUser {
  id: string;
  name: string;
  email: string;
}

export interface ShareInviteFormProps {
  /** Already-shared user ids, to guard against duplicate invite */
  existingSharedUserIds?: string[];
  notePath: string;
  isFolder?: boolean;
  onInvite: (params: {
    userId: string;
    permission: SharePermission;
    shareAsFolder: boolean;
  }) => Promise<void>;
  /** Called by consumer to search for a user by email */
  onSearchUser: (email: string) => Promise<FoundUser>;
  className?: string;
}

export function ShareInviteForm({
  existingSharedUserIds = [],
  notePath,
  isFolder,
  onInvite,
  onSearchUser,
  className,
}: ShareInviteFormProps) {
  const [emailQuery, setEmailQuery] = useState("");
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [permission, setPermission] = useState<SharePermission>("read");
  const [shareAsFolder, setShareAsFolder] = useState(!!isFolder);
  const [sharing, setSharing] = useState(false);
  const [shareSuccess, setShareSuccess] = useState("");
  const [shareError, setShareError] = useState("");

  const handleSearch = useCallback(async () => {
    const trimmed = emailQuery.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError("");
    setFoundUser(null);
    setShareSuccess("");
    setShareError("");
    try {
      const user = await onSearchUser(trimmed);
      if (existingSharedUserIds.includes(user.id)) {
        setSearchError("Already shared with this user");
      } else {
        setFoundUser(user);
      }
    } catch {
      setSearchError("User not found");
    } finally {
      setSearching(false);
    }
  }, [emailQuery, existingSharedUserIds, onSearchUser]);

  const handleShare = useCallback(async () => {
    if (!foundUser) return;
    setSharing(true);
    setShareError("");
    setShareSuccess("");
    try {
      await onInvite({ userId: foundUser.id, permission, shareAsFolder });
      setShareSuccess(`Shared with ${foundUser.email}`);
      setFoundUser(null);
      setEmailQuery("");
    } catch (err: unknown) {
      const error = err as Error;
      setShareError(error?.message || "Failed to share");
    } finally {
      setSharing(false);
    }
  }, [foundUser, permission, shareAsFolder, onInvite]);

  const showFolderOption = isFolder || notePath.includes("/");

  return (
    <div className={cn("space-y-3", className)}>
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        Share with user
      </label>
      <div className="flex gap-2">
        <input
          type="email"
          value={emailQuery}
          onChange={(e) => {
            setEmailQuery(e.target.value);
            setSearchError("");
            setFoundUser(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="Enter email address..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border dark:border-surface-600 bg-transparent outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching || !emailQuery.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Search size={14} />
          Find
        </button>
      </div>

      {searchError && (
        <p className="text-xs text-red-500 dark:text-red-400">{searchError}</p>
      )}

      {foundUser && (
        <div className="rounded-lg border dark:border-surface-600 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500 text-sm font-semibold">
              {foundUser.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{foundUser.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {foundUser.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Permission:
            </span>
            <div className="relative">
              <select
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value as SharePermission)
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
          </div>

          {showFolderOption && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={shareAsFolder}
                onChange={(e) => setShareAsFolder(e.target.checked)}
                className="rounded border-gray-300 dark:border-surface-600 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Share entire folder
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <UserPlus size={14} />
            {sharing ? "Sharing..." : "Share"}
          </button>
        </div>
      )}

      {shareSuccess && (
        <p className="text-xs text-green-500 dark:text-green-400">
          {shareSuccess}
        </p>
      )}
      {shareError && (
        <p className="text-xs text-red-500 dark:text-red-400">{shareError}</p>
      )}
    </div>
  );
}
