import { useState, useCallback } from 'react';
import { Trash2, RotateCcw, XCircle, ChevronRight } from 'lucide-react';
import { api, TrashItem } from '../../lib/api';

interface TrashPaneProps {
  items: TrashItem[];
  onRefresh: () => void;
}

export function TrashPane({ items, onRefresh }: TrashPaneProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [loading, setLoading] = useState<string | null>(null);

  const handleRestore = useCallback(async (item: TrashItem) => {
    setLoading(`restore:${item.path}`);
    try {
      await api.restoreFromTrash(item.path);
      onRefresh();
    } catch (err) {
      alert(`Failed to restore: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
    }
  }, [onRefresh]);

  const handlePermanentDelete = useCallback(async (item: TrashItem) => {
    const confirmed = window.confirm(`Permanently delete "${item.path}"? This cannot be undone.`);
    if (!confirmed) return;
    setLoading(`delete:${item.path}`);
    try {
      await api.permanentlyDelete(item.path);
      onRefresh();
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
    }
  }, [onRefresh]);

  const handleEmptyTrash = useCallback(async () => {
    if (items.length === 0) return;
    const confirmed = window.confirm(`Permanently delete all ${items.length} trashed note(s)? This cannot be undone.`);
    if (!confirmed) return;
    setLoading('empty');
    try {
      await api.emptyTrash();
      onRefresh();
    } catch (err) {
      alert(`Failed to empty trash: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
    }
  }, [items.length, onRefresh]);

  return (
    <div className="border-t">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full px-3 py-1.5 flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`text-gray-400 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <Trash2 size={11} />
          Trash
          {items.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-gray-400 dark:text-gray-500">
              ({items.length})
            </span>
          )}
        </span>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {items.length === 0 ? (
            <p className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
              Trash is empty
            </p>
          ) : (
            <>
              {items.map((item) => {
                const displayName = item.path.split('/').pop()?.replace(/\.md$/, '') || item.path;
                const isRestoringThis = loading === `restore:${item.path}`;
                const isDeletingThis = loading === `delete:${item.path}`;

                return (
                  <div
                    key={item.path}
                    className="group flex items-center gap-1 px-2 py-1 mx-1 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <Trash2 size={13} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
                    <span className="flex-1 truncate text-xs" title={item.path}>
                      {displayName}
                    </span>
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={isRestoringThis || isDeletingThis || loading === 'empty'}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 disabled:opacity-40 transition-opacity"
                      title="Restore"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={isRestoringThis || isDeletingThis || loading === 'empty'}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 transition-opacity"
                      title="Delete permanently"
                    >
                      <XCircle size={13} />
                    </button>
                  </div>
                );
              })}
              <div className="px-3 pt-1">
                <button
                  onClick={handleEmptyTrash}
                  disabled={loading === 'empty'}
                  className="w-full text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                >
                  {loading === 'empty' ? 'Emptying...' : 'Empty Trash'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
