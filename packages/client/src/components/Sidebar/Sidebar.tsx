import { useState, useCallback } from 'react';
import { FileNode } from '../../lib/api';
import { FileText, Folder, FolderOpen, ChevronRight, Plus, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [creating, setCreating] = useState<{ type: 'file' | 'folder'; parentPath: string } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; type: 'file' | 'folder' } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [newName, setNewName] = useState('');

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async (type: 'file' | 'folder', parentPath: string) => {
    setCreating({ type, parentPath });
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

  const handleDelete = useCallback(async (node: FileNode) => {
    const confirmed = window.confirm(`Delete "${node.name}"?`);
    if (!confirmed) return;
    if (node.type === 'file') {
      await onDeleteNote(node.path);
    } else {
      await onDeleteFolder(node.path);
    }
  }, [onDeleteNote, onDeleteFolder]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const renderNode = (node: FileNode, depth: number) => {
    const isActive = node.type === 'file' && node.path === activeNotePath;
    const isExpanded = expanded.has(node.path);
    const isRenaming = renaming?.path === node.path;
    const displayName = node.type === 'file' ? node.name.replace(/\.md$/, '') : node.name;

    return (
      <div key={node.path}>
        <div
          className={`group flex items-center gap-1 px-2 py-1 cursor-pointer text-sm rounded-md mx-1 transition-colors duration-100
            ${isActive
              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/40'
            }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.type === 'folder') toggleExpand(node.path);
            else onSelect(node.path);
          }}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          {node.type === 'folder' ? (
            <>
              <ChevronRight
                size={14}
                className={`flex-shrink-0 text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
              />
              {isExpanded ? (
                <FolderOpen size={15} className="flex-shrink-0 text-blue-500/70" />
              ) : (
                <Folder size={15} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <FileText size={15} className={`flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} />
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
              className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate">{displayName}</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().top, node });
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300/50 dark:hover:bg-gray-600/50 transition-opacity"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
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
                  className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Notes</span>
        <div className="flex items-center gap-0.5">
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
              className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}
        {tree.map((node) => renderNode(node, 0))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-800 border rounded-lg shadow-lg py-1 min-w-[160px] z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
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
          <button
            onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
