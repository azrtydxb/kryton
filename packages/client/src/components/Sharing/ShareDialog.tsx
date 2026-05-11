import { useState, useEffect, useCallback } from 'react';
import { ShareDialog as UiShareDialog } from '@azrtydxb/ui';
import type { ShareEntry } from '@azrtydxb/ui';
import { shareApi, NoteShareData } from '../../lib/api';

interface ShareDialogProps {
  notePath: string;
  isFolder?: boolean;
  onClose: () => void;
}

interface ShareRecord extends NoteShareData {
  sharedWithEmail?: string;
  sharedWithName?: string;
}

/**
 * Thin wrapper around @azrtydxb/ui ShareDialog.
 * Manages data-fetching and HTTP callbacks; ui component handles rendering.
 */
export function ShareDialog({ notePath, isFolder, onClose }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);

  const fetchShares = useCallback(async () => {
    try {
      const all = await shareApi.list();
      setShares(all.filter((s: NoteShareData) => s.path === notePath) as ShareRecord[]);
    } catch {
      // silently fail
    } finally {
      setLoadingShares(false);
    }
  }, [notePath]);

  useEffect(() => {
    void (async () => {
      await fetchShares();
    })();
  }, [fetchShares]);

  const handleSearchUser = useCallback(async (email: string) => {
    return shareApi.searchUser(email);
  }, []);

  const handleInvite = useCallback(async ({
    userId,
    permission,
    shareAsFolder,
  }: {
    userId: string;
    permission: 'read' | 'readwrite';
    shareAsFolder: boolean;
  }) => {
    await shareApi.create({
      path: notePath,
      isFolder: shareAsFolder,
      sharedWithUserId: userId,
      permission,
    });
    await fetchShares();
  }, [notePath, fetchShares]);

  const handleTogglePermission = useCallback(async (share: ShareEntry) => {
    const newPerm = share.permission === 'read' ? 'readwrite' : 'read';
    await shareApi.update(share.id, newPerm);
    setShares(prev =>
      prev.map(s => s.id === share.id ? { ...s, permission: newPerm } : s),
    );
  }, []);

  const handleRevoke = useCallback(async (id: string) => {
    await shareApi.revoke(id);
    setShares(prev => prev.filter(s => s.id !== id));
  }, []);

  // Map client's NoteShareData to ui's ShareEntry shape
  const shareEntries: ShareEntry[] = shares.map(s => ({
    id: s.id,
    sharedWithUserId: s.sharedWithUserId,
    sharedWithEmail: s.sharedWithEmail,
    sharedWithName: s.sharedWithName,
    permission: s.permission as 'read' | 'readwrite',
  }));

  return (
    <UiShareDialog
      notePath={notePath}
      isFolder={isFolder}
      shares={shareEntries}
      loadingShares={loadingShares}
      onClose={onClose}
      onSearchUser={handleSearchUser}
      onInvite={handleInvite}
      onTogglePermission={handleTogglePermission}
      onRevoke={handleRevoke}
    />
  );
}
