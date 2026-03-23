import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, UserPlus, Trash2, Share2, ChevronDown } from 'lucide-react';
import { shareApi, NoteShareData } from '../../lib/api';

interface ShareDialogProps {
  notePath: string;
  isFolder?: boolean;
  onClose: () => void;
}

interface FoundUser {
  id: string;
  name: string;
  email: string;
}

interface ShareRecord extends NoteShareData {
  sharedWithEmail?: string;
  sharedWithName?: string;
}

type Permission = 'read' | 'readwrite';

export function ShareDialog({ notePath, isFolder: isFolderProp, onClose }: ShareDialogProps) {
  const [emailQuery, setEmailQuery] = useState('');
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);

  const [permission, setPermission] = useState<Permission>('read');
  const [shareAsFolder, setShareAsFolder] = useState(!!isFolderProp);
  const [sharing, setSharing] = useState(false);
  const [shareSuccess, setShareSuccess] = useState('');
  const [shareError, setShareError] = useState('');

  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);

  const dialogRef = useRef<HTMLDivElement>(null);

  const fetchShares = useCallback(async () => {
    try {
      const all = await shareApi.list();
      setShares(all.filter((s: ShareRecord) => s.path === notePath));
    } catch {
      // silently fail
    } finally {
      setLoadingShares(false);
    }
  }, [notePath]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleSearch = useCallback(async () => {
    const trimmed = emailQuery.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError('');
    setFoundUser(null);
    setShareSuccess('');
    setShareError('');
    try {
      const user = await shareApi.searchUser(trimmed);
      // Check if already shared with this user
      const alreadyShared = shares.some((s) => s.sharedWithUserId === user.id);
      if (alreadyShared) {
        setSearchError('Already shared with this user');
      } else {
        setFoundUser(user);
      }
    } catch {
      setSearchError('User not found');
    } finally {
      setSearching(false);
    }
  }, [emailQuery, shares]);

  const handleShare = useCallback(async () => {
    if (!foundUser) return;
    setSharing(true);
    setShareError('');
    setShareSuccess('');
    try {
      await shareApi.create({
        path: notePath,
        isFolder: shareAsFolder,
        sharedWithUserId: foundUser.id,
        permission,
      });
      setShareSuccess(`Shared with ${foundUser.email}`);
      setFoundUser(null);
      setEmailQuery('');
      await fetchShares();
    } catch (err: unknown) {
      const error = err as Error;
      setShareError(error?.message || 'Failed to share');
    } finally {
      setSharing(false);
    }
  }, [foundUser, notePath, shareAsFolder, permission, fetchShares]);

  const handleRevoke = useCallback(
    async (id: string) => {
      try {
        await shareApi.revoke(id);
        setShares((prev) => prev.filter((s) => s.id !== id));
      } catch {
        // silently fail
      }
    },
    [],
  );

  const handleTogglePermission = useCallback(
    async (share: ShareRecord) => {
      const newPerm = share.permission === 'read' ? 'readwrite' : 'read';
      try {
        await shareApi.update(share.id, newPerm);
        setShares((prev) =>
          prev.map((s) => (s.id === share.id ? { ...s, permission: newPerm } : s)),
        );
      } catch {
        // silently fail
      }
    },
    [],
  );

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-surface-900 rounded-xl shadow-2xl border dark:border-surface-700 w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-violet-500" />
            <h2 className="text-sm font-semibold truncate">Share {notePath}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* User search section */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Share with user
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailQuery}
                onChange={(e) => {
                  setEmailQuery(e.target.value);
                  setSearchError('');
                  setFoundUser(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                placeholder="Enter email address..."
                className="flex-1 px-3 py-2 text-sm rounded-lg border dark:border-surface-600 bg-transparent outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <button
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

            {/* Found user card */}
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

                {/* Permission picker */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Permission:</span>
                  <div className="relative">
                    <select
                      value={permission}
                      onChange={(e) => setPermission(e.target.value as Permission)}
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

                {/* Share as folder checkbox */}
                {(isFolderProp || notePath.includes('/')) && (
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
                  onClick={handleShare}
                  disabled={sharing}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserPlus size={14} />
                  {sharing ? 'Sharing...' : 'Share'}
                </button>
              </div>
            )}

            {/* Success / Error messages */}
            {shareSuccess && (
              <p className="text-xs text-green-500 dark:text-green-400">{shareSuccess}</p>
            )}
            {shareError && (
              <p className="text-xs text-red-500 dark:text-red-400">{shareError}</p>
            )}
          </div>

          {/* Current shares section */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Current shares
            </label>
            {loadingShares ? (
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
                      onClick={() => handleTogglePermission(share)}
                      className={`px-2 py-0.5 text-xs font-medium rounded-full transition-colors cursor-pointer ${
                        share.permission === 'readwrite'
                          ? 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30'
                          : 'bg-gray-200 dark:bg-surface-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-surface-600'
                      }`}
                      title="Click to toggle permission"
                    >
                      {share.permission === 'readwrite' ? 'Read-Write' : 'Read'}
                    </button>
                    <button
                      onClick={() => handleRevoke(share.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Revoke access"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
