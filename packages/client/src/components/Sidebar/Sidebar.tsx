import { useState, useCallback, useEffect } from 'react';
import { FileNode, TrashItem, api } from '../../lib/api';
import { Calendar, LayoutTemplate, Plus, PanelLeft } from 'lucide-react';
import { FileTree, FavoritesSection, TrashList, Resizer } from '@azrtydxb/ui';
import type { TrashItem as UiTrashItem } from '@azrtydxb/ui';
import { TagPane } from '../Tags/TagPane';
import { useToastStore } from '../../stores/toastStore';

interface SharedNote {
  id: string;
  ownerUserId: string;
  ownerName: string;
  path: string;
  isFolder: boolean;
  permission: string;
}

interface SidebarProps {
  tree: FileNode[];
  activeNotePath: string | null;
  onSelect: (path: string) => void;
  onCreateNote: (path: string, content?: string) => Promise<unknown>;
  onDeleteNote: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void>;
  onDailyNote: () => void;
  onCreateFromTemplate: () => void;
  starredPaths: Set<string>;
  onToggleStar: (path: string) => void;
  sharedNotes?: SharedNote[];
  onShare?: (path: string, isFolder: boolean) => void;
}

/**
 * Sidebar — wires data and callbacks; delegates rendering to @azrtydxb/ui
 * primitives (FileTree, FavoritesSection, TrashList, TagPane).
 * Reduced from ~650 lines to ~120 lines.
 */
export function Sidebar({
  tree,
  activeNotePath,
  onSelect,
  onCreateNote,
  onDeleteNote,
  onRenameNote,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onDailyNote,
  onCreateFromTemplate,
  starredPaths,
  onToggleStar,
  sharedNotes,
  onShare,
}: SidebarProps) {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoadingKey, setTrashLoadingKey] = useState<string | null>(null);
  const [tagPaneHeight, setTagPaneHeight] = useState(180);
  const addToast = useToastStore(s => s.addToast);

  const refreshTrash = useCallback(() => {
    api.listTrash().then(setTrashItems).catch(() => setTrashItems([]));
  }, []);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const handleTagResize = useCallback((delta: number) => {
    setTagPaneHeight(h => Math.max(60, Math.min(500, h - delta)));
  }, []);

  const handleTrashRestore = useCallback(async (item: UiTrashItem) => {
    setTrashLoadingKey(`restore:${item.path}`);
    try {
      await api.restoreFromTrash(item.path);
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to restore: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  const handleTrashDelete = useCallback(async (item: UiTrashItem) => {
    setTrashLoadingKey(`delete:${item.path}`);
    try {
      await api.permanentlyDelete(item.path);
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  const handleEmptyTrash = useCallback(async () => {
    setTrashLoadingKey('empty');
    try {
      await api.emptyTrash();
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to empty trash: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  const uiTrashItems = trashItems.map(item => ({ path: item.path }));

  return (
    <div className="h-full flex flex-col">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Notes
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onDailyNote}
            className="btn-ghost p-1.5"
            title="Today's daily note"
            aria-label="Today's daily note"
          >
            <Calendar size={15} />
          </button>
          <button
            type="button"
            onClick={onCreateFromTemplate}
            className="btn-ghost p-1.5"
            title="New from template"
            aria-label="New from template"
          >
            <LayoutTemplate size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              // Trigger root-level file creation in FileTree via custom event
              window.dispatchEvent(new CustomEvent('kryton:new-note-root'));
            }}
            className="btn-ghost p-1.5"
            title="New note"
            aria-label="New note"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Favorites */}
      <FavoritesSection
        starredPaths={starredPaths}
        onSelect={onSelect}
        onToggleStar={onToggleStar}
      />

      {/* File tree */}
      <div className="flex-1 overflow-hidden">
        <FileTree
          tree={tree}
          activeNotePath={activeNotePath}
          starredPaths={starredPaths}
          sharedNotes={sharedNotes}
          onSelect={onSelect}
          onCreateNote={onCreateNote}
          onDeleteNote={onDeleteNote}
          onRenameNote={onRenameNote}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onToggleStar={onToggleStar}
          onShare={onShare}
        />
      </div>

      {/* Resize handle between file tree and tags */}
      <Resizer orientation="vertical" onResize={handleTagResize} />

      {/* Tag Pane */}
      <div className="flex-shrink-0 overflow-hidden" style={{ height: `${tagPaneHeight}px` }}>
        <TagPane onNoteSelect={onSelect} />
      </div>

      {/* Trash Pane */}
      <TrashList
        items={uiTrashItems}
        loadingKey={trashLoadingKey}
        onRestore={handleTrashRestore}
        onPermanentDelete={handleTrashDelete}
        onEmptyTrash={handleEmptyTrash}
      />
    </div>
  );
}
