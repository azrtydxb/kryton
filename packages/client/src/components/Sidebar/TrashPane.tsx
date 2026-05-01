import { useState, useCallback } from 'react';
import { TrashList } from '@azrtydxb/ui';
import type { TrashItem as UiTrashItem } from '@azrtydxb/ui';
import { api, TrashItem } from '../../lib/api';
import { useToastStore } from '../../stores/toastStore';

interface TrashPaneProps {
  items: TrashItem[];
  onRefresh: () => void;
}

/**
 * Thin wrapper around @azrtydxb/ui TrashList.
 * Manages HTTP operations; ui component handles all rendering.
 */
export function TrashPane({ items, onRefresh }: TrashPaneProps) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const addToast = useToastStore(s => s.addToast);

  const handleRestore = useCallback(async (item: UiTrashItem) => {
    setLoadingKey(`restore:${item.path}`);
    try {
      await api.restoreFromTrash(item.path);
      onRefresh();
    } catch (err) {
      addToast('error', `Failed to restore: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingKey(null);
    }
  }, [onRefresh, addToast]);

  const handlePermanentDelete = useCallback(async (item: UiTrashItem) => {
    setLoadingKey(`delete:${item.path}`);
    try {
      await api.permanentlyDelete(item.path);
      onRefresh();
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingKey(null);
    }
  }, [onRefresh, addToast]);

  const handleEmptyTrash = useCallback(async () => {
    if (items.length === 0) return;
    setLoadingKey('empty');
    try {
      await api.emptyTrash();
      onRefresh();
    } catch (err) {
      addToast('error', `Failed to empty trash: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingKey(null);
    }
  }, [items.length, onRefresh, addToast]);

  // Map client's TrashItem shape to ui's TrashItem shape (path only)
  const uiItems = items.map(item => ({ path: item.path }));

  return (
    <TrashList
      items={uiItems}
      loadingKey={loadingKey}
      onRestore={handleRestore}
      onPermanentDelete={handlePermanentDelete}
      onEmptyTrash={handleEmptyTrash}
    />
  );
}
