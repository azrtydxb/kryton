import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { FileNode, TrashItem, api } from '../../lib/api';
import { FileText, Folder, FolderOpen, ChevronRight, Plus, FolderPlus, MoreHorizontal, Pencil, Trash2, Calendar, LayoutTemplate, Star, Share2 } from 'lucide-react';
import { TagPane } from '../Tags/TagPane';
import { ResizeHandle } from '../Layout/ResizeHandle';
import { TrashPane } from './TrashPane';
import { FavoritesPane } from './FavoritesPane';

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [creating, setCreating] = useState<{ type: 'file' | 'folder'; parentPath: string } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; type: 'file' | 'folder' } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [newName, setNewName] = useState('');
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [draggedType, setDraggedType] = useState<'file' | 'folder' | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);
  const [sharedCollapsed, setSharedCollapsed] = useState(false);
  const [tagPaneHeight, setTagPaneHeight] = useState(180);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const handleTagResize = useCallback((delta: number) => {
    setTagPaneHeight(h => Math.max(60, Math.min(500, h - delta)));
  }, []);

  const refreshTrash = useCallback(() => {
    api.listTrash().then(setTrashItems).catch(() => setTrashItems([]));
  }, []);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  // Listen for external rename requests (F2 shortcut)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.path) {
        const name = detail.path.split('/').pop()?.replace(/\.md$/, '') || '';
        setRenaming({ path: detail.path, type: 'file' });
        setNewName(name);
      }
    };
    window.addEventListener('kryton:rename-note', handler);
    return () => window.removeEventListener('kryton:rename-note', handler);
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCreate = useCallback((_type: 'file' | 'folder', parentPath: string) => {
    setCreating({ type: _type, parentPath });
    setNewName('');
  }, []);

  const submitCreate = useCallback(async () => {
    if (!creating || !newName.trim()) {
      setCreating(null);
      return;
    }
    const fullPath = creating.parentPath ? `${creating.parentPath}/${newName.trim()}` : newName.trim();
    if (creating.type === 'file') {
      await onCreateNote(fullPath);
    } else {
      await onCreateFolder(fullPath);
      setExpanded(prev => new Set(prev).add(fullPath));
    }
    setCreating(null);
    setNewName('');
  }, [creating, newName, onCreateNote, onCreateFolder]);

  const handleRename = useCallback(async () => {
    if (!renaming || !newName.trim()) {
      setRenaming(null);
      return;
    }
    const parts = renaming.path.split('/');
    parts[parts.length - 1] = renaming.type === 'file' ? newName.trim().replace(/\.md$/, '') + '.md' : newName.trim();
    const newPath = parts.join('/');
    if (renaming.type === 'file') {
      await onRenameNote(renaming.path, newPath);
    } else {
      await onRenameFolder(renaming.path, newPath);
    }
    setRenaming(null);
    setNewName('');
  }, [renaming, newName, onRenameNote, onRenameFolder]);

  const handleDeleteConfirmed = useCallback(async (node: FileNode) => {
    setPendingDelete(null);
    if (node.type === 'file') {
      await onDeleteNote(node.path);
      refreshTrash();
    } else {
      await onDeleteFolder(node.path);
    }
  }, [onDeleteNote, onDeleteFolder, refreshTrash]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // Close context menu on outside click (needed since it's portaled)
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => {
      setContextMenu(null);
    };
    // Use setTimeout to avoid the current right-click event from immediately closing it
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [contextMenu]);

  const handleDragStart = useCallback((e: React.DragEvent, node: FileNode) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.path);
    setDraggedPath(node.path);
    setDraggedType(node.type);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, node: FileNode) => {
    if (node.type !== 'folder') return;
    if (!draggedPath) return;

    // Prevent dropping a folder into itself or any of its descendants
    if (draggedType === 'folder') {
      const normalizedDragged = draggedPath.endsWith('/') ? draggedPath : draggedPath + '/';
      if (node.path === draggedPath || node.path.startsWith(normalizedDragged)) return;
    }

    // Prevent dropping onto the folder that already contains the dragged item
    const draggedParent = draggedPath.includes('/')
      ? draggedPath.substring(0, draggedPath.lastIndexOf('/'))
      : '';
    if (node.path === draggedParent) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(node.path);
  }, [draggedPath, draggedType]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: FileNode) => {
    e.preventDefault();
    setDragOverPath(null);

    const sourcePath = e.dataTransfer.getData('text/plain') || draggedPath;
    if (!sourcePath || targetNode.type !== 'folder') return;
    if (sourcePath === targetNode.path) return;

    // Prevent dropping a folder into itself or any descendant
    if (draggedType === 'folder') {
      const normalizedDragged = sourcePath.endsWith('/') ? sourcePath : sourcePath + '/';
      if (targetNode.path.startsWith(normalizedDragged)) return;
    }

    // Prevent dropping onto the current parent folder
    const sourceParent = sourcePath.includes('/')
      ? sourcePath.substring(0, sourcePath.lastIndexOf('/'))
      : '';
    if (targetNode.path === sourceParent) return;

    const filename = sourcePath.split('/').pop()!;
    const newPath = `${targetNode.path}/${filename}`;

    if (draggedType === 'folder') {
      await onRenameFolder(sourcePath, newPath);
      setExpanded(prev => {
        const next = new Set(prev);
        next.add(newPath);
        return next;
      });
    } else {
      await onRenameNote(sourcePath, newPath);
    }
    // Expand the target folder so the moved item is visible
    setExpanded(prev => new Set(prev).add(targetNode.path));
  }, [draggedPath, draggedType, onRenameNote, onRenameFolder]);

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null);
    setDraggedType(null);
    setDragOverPath(null);
  }, []);

  // Group shared notes by owner (memoized to avoid re-computation on every render)
  const sharedNotesByOwner = useMemo(() => {
    if (!sharedNotes || sharedNotes.length === 0) return [] as [string, SharedNote[]][];
    const byOwner = new Map<string, SharedNote[]>();
    for (const note of sharedNotes) {
      const existing = byOwner.get(note.ownerUserId);
      if (existing) existing.push(note);
      else byOwner.set(note.ownerUserId, [note]);
    }
    return Array.from(byOwner.entries());
  }, [sharedNotes]);

  // SidebarNode is memoized to prevent O(n) DOM reconstruction on every render
  const SidebarNode = useMemo(() => memo(function SidebarNode({ node, depth }: { node: FileNode; depth: number }) {
    const isActive = node.type === 'file' && node.path === activeNotePath;
    const isExpanded = expanded.has(node.path);
    const isRenaming = renaming?.path === node.path;
    const isStarred = node.type === 'file' && starredPaths.has(node.path);
    const isDragging = node.path === draggedPath;
    const isDragOver = node.type === 'folder' && node.path === dragOverPath;
    const displayName = node.type === 'file' ? node.name.replace(/\.md$/, '') : node.name;

    return (
      <div>
        <button
          draggable
          role="treeitem"
          aria-expanded={node.type === 'folder' ? isExpanded : undefined}
          tabIndex={0}
          className={`group w-full flex items-center gap-1 px-2 py-1 text-sm rounded-md mx-1 transition-colors duration-100
            ${isDragging ? 'opacity-50' : ''}
            ${isDragOver
              ? 'bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400'
              : isActive
                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/40'
            }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.type === 'folder') toggleExpand(node.path);
            else onSelect(node.path);
          }}
          onContextMenu={(e) => handleContextMenu(e, node)}
          onDragStart={(e) => handleDragStart(e, node)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, node)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node)}
        >
          {node.type === 'folder' ? (
            <>
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={`flex-shrink-0 text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
              />
              {isExpanded ? (
                <FolderOpen size={15} aria-hidden="true" className="flex-shrink-0 text-violet-500/70" />
              ) : (
                <Folder size={15} aria-hidden="true" className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <FileText size={15} aria-hidden="true" className={`flex-shrink-0 ${isActive ? 'text-violet-500' : 'text-gray-400 dark:text-gray-500'}`} />
            </>
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-violet-500"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate">{displayName}</span>
          )}
          {node.type === 'file' && !isRenaming && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(node.path);
              }}
              className={`p-0.5 rounded transition-opacity ${
                isStarred
                  ? 'text-yellow-500 opacity-100'
                  : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-yellow-500'
              }`}
              title={isStarred ? 'Unstar' : 'Star'}
            >
              <Star size={13} aria-hidden="true" fill={isStarred ? 'currentColor' : 'none'} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().top, node });
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300/50 dark:hover:bg-gray-600/50 transition-opacity"
            aria-label="More options"
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        </button>
        {node.type === 'folder' && isExpanded && node.children && (
          <div>
            {creating && creating.parentPath === node.path && (
              <div className="flex items-center gap-1 px-2 py-1 mx-1" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
                {creating.type === 'file' ? <FileText size={15} className="text-gray-400" /> : <Folder size={15} className="text-gray-400" />}
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={submitCreate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCreate();
                    if (e.key === 'Escape') setCreating(null);
                  }}
                  placeholder={creating.type === 'file' ? 'Note name...' : 'Folder name...'}
                  className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            )}
            {node.children.map((child) => (
              <SidebarNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }), [activeNotePath, expanded, renaming, starredPaths, draggedPath, dragOverPath, newName,
      toggleExpand, onSelect, handleContextMenu, handleDragStart, handleDragEnd, handleDragOver,
      handleDragLeave, handleDrop, handleRename, onToggleStar, creating, submitCreate, setContextMenu,
      setRenaming, setNewName, setCreating]);

  return (
    <div className="h-full flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Notes</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onDailyNote}
            className="btn-ghost p-1.5"
            title="Today's daily note"
            aria-label="Today's daily note"
          >
            <Calendar size={15} />
          </button>
          <button
            onClick={onCreateFromTemplate}
            className="btn-ghost p-1.5"
            title="New from template"
            aria-label="New from template"
          >
            <LayoutTemplate size={15} />
          </button>
          <button
            onClick={() => handleCreate('file', '')}
            className="btn-ghost p-1.5"
            title="New note"
            aria-label="New note"
          >
            <Plus size={15} />
          </button>
          <button
            onClick={() => handleCreate('folder', '')}
            className="btn-ghost p-1.5"
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      {/* Favorites section */}
      <FavoritesPane
        starredPaths={starredPaths}
        onSelect={onSelect}
        onToggleStar={onToggleStar}
      />

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {creating && creating.parentPath === '' && (
          <div className="flex items-center gap-1 px-2 py-1 mx-1" style={{ paddingLeft: '8px' }}>
            {creating.type === 'file' ? <FileText size={15} className="text-gray-400" /> : <Folder size={15} className="text-gray-400" />}
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={submitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
                if (e.key === 'Escape') setCreating(null);
              }}
              placeholder={creating.type === 'file' ? 'Note name...' : 'Folder name...'}
              className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
        )}
        {tree.map((node) => (
          <SidebarNode key={node.path} node={node} depth={0} />
        ))}
      </div>

      {/* Shared section */}
      {sharedNotesByOwner.length > 0 && (
        <div className="border-t">
          <button
            onClick={() => setSharedCollapsed(prev => !prev)}
            className="w-full px-3 py-1.5 flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronRight
              size={12}
              className={`text-gray-400 transition-transform duration-150 ${sharedCollapsed ? '' : 'rotate-90'}`}
            />
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
              <Share2 size={11} />
              Shared
            </span>
          </button>
          {!sharedCollapsed && (
            <div className="pb-1">
              {sharedNotesByOwner.map(([ownerUserId, notes]) => (
                <div key={ownerUserId}>
                  <div className="px-3 py-0.5">
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {notes[0].ownerName}
                    </span>
                  </div>
                  {notes.map((note) => {
                    const sharedId = `shared:${note.ownerUserId}:${note.path}`;
                    const fileName = note.path.split('/').pop()?.replace(/\.md$/, '') || note.path;
                    return (
                      <button
                        key={sharedId}
                        className={`group w-full flex items-center gap-1 px-2 py-1 text-sm rounded-md mx-1 transition-colors duration-100
                          ${sharedId === activeNotePath
                            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/40'
                          }`}
                        style={{ paddingLeft: '20px' }}
                        onClick={() => onSelect(sharedId)}
                      >
                        <Share2 size={13} className="flex-shrink-0 text-amber-500" />
                        <span className="flex-1 truncate">{fileName}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          {note.permission}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resize handle between file tree and tags */}
      <ResizeHandle direction="vertical" onResize={handleTagResize} />

      {/* Tag Pane */}
      <div className="flex-shrink-0 overflow-hidden" style={{ height: `${tagPaneHeight}px` }}>
        <TagPane onNoteSelect={onSelect} />
      </div>

      {/* Trash Pane */}
      <TrashPane items={trashItems} onRefresh={refreshTrash} />

      {/* Context menu - portaled to body to escape sidebar's stacking context */}
      {contextMenu && createPortal(
        <div
          className="fixed bg-white dark:bg-gray-800 border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 99999 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.type === 'folder' && (
            <>
              <button
                onClick={() => { handleCreate('file', contextMenu.node.path); setContextMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                <Plus size={14} /> New note here
              </button>
              <button
                onClick={() => { handleCreate('folder', contextMenu.node.path); setContextMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                <FolderPlus size={14} /> New folder here
              </button>
              {onShare && (
                <button
                  onClick={() => { onShare(contextMenu.node.path, true); setContextMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <Share2 size={14} /> Share folder...
                </button>
              )}
              <div className="border-t my-1" />
            </>
          )}
          {contextMenu.node.type === 'file' && (
            <>
              <button
                onClick={() => {
                  onToggleStar(contextMenu.node.path);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                <Star size={14} /> {starredPaths.has(contextMenu.node.path) ? 'Unstar' : 'Star'}
              </button>
              {onShare && (
                <button
                  onClick={() => { onShare(contextMenu.node.path, false); setContextMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <Share2 size={14} /> Share...
                </button>
              )}
              <div className="border-t my-1" />
            </>
          )}
          <button
            onClick={() => {
              const name = contextMenu.node.type === 'file'
                ? contextMenu.node.name.replace(/\.md$/, '')
                : contextMenu.node.name;
              setRenaming({ path: contextMenu.node.path, type: contextMenu.node.type });
              setNewName(name);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            <Pencil size={14} /> Rename
          </button>
          {pendingDelete?.path === contextMenu.node.path ? (
            <div className="px-3 py-1.5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Delete &quot;{contextMenu.node.name}&quot;?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { handleDeleteConfirmed(contextMenu.node); setContextMenu(null); }}
                  className="flex-1 text-xs bg-red-500 text-white rounded px-2 py-1 hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setPendingDelete(null)}
                  className="flex-1 text-xs border rounded px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setPendingDelete(contextMenu.node); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
