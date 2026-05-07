import * as React from "react";
import { useState, useCallback, useEffect, memo, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  Plus,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Star,
  Share2,
} from "lucide-react";
import { cn } from "../lib/utils";

/** Tree node shape — mirrors client's FileNode without importing from client. */
export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
}

/** Count file leaves under a folder (recursive). Used for the right-aligned
 *  count chip on each folder row, matching prototype/app/sidebar.jsx. */
function countLeaves(node: FileTreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  let n = 0;
  for (const child of node.children) n += countLeaves(child);
  return n;
}

export interface SharedNote {
  id: string;
  ownerUserId: string;
  ownerName: string;
  path: string;
  isFolder: boolean;
  permission: string;
}

export interface FileTreeProps {
  tree: FileTreeNode[];
  activeNotePath: string | null;
  starredPaths: Set<string>;
  sharedNotes?: SharedNote[];
  onSelect: (path: string) => void;
  onCreateNote: (path: string, content?: string) => Promise<unknown>;
  onDeleteNote: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void>;
  onToggleStar: (path: string) => void;
  onShare?: (path: string, isFolder: boolean) => void;
}

export function FileTree({
  tree,
  activeNotePath,
  starredPaths,
  sharedNotes,
  onSelect,
  onCreateNote,
  onDeleteNote,
  onRenameNote,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onToggleStar,
  onShare,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [creating, setCreating] = useState<{ type: "file" | "folder"; parentPath: string } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; type: "file" | "folder" } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileTreeNode } | null>(null);
  const [newName, setNewName] = useState("");
  // State *and* ref pair for the in-flight drag. State drives re-renders
  // (so `isDragging` styling flips on visually). The refs are read inside
  // dragover/drop handlers — React batches setState, so the first dragover
  // immediately after dragstart would otherwise see a stale null and the
  // drop zone would silently reject the first drag attempt.
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [draggedType, setDraggedType] = useState<"file" | "folder" | null>(null);
  const draggedPathRef = useRef<string | null>(null);
  const draggedTypeRef = useRef<"file" | "folder" | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileTreeNode | null>(null);
  const [sharedCollapsed, setSharedCollapsed] = useState(false);

  // Listen for external rename requests (F2 shortcut)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.path) {
        const name = detail.path.split("/").pop()?.replace(/\.md$/, "") || "";
        setRenaming({ path: detail.path, type: "file" });
        setNewName(name);
      }
    };
    window.addEventListener("kryton:rename-note", handler);
    return () => window.removeEventListener("kryton:rename-note", handler);
  }, []);

  // Listen for external root-create requests (sidebar Files section header buttons).
  useEffect(() => {
    const onCreateFile = () => {
      setCreating({ type: "file", parentPath: "" });
      setNewName("");
    };
    const onCreateFolderEvt = () => {
      setCreating({ type: "folder", parentPath: "" });
      setNewName("");
    };
    window.addEventListener("kryton:create-root-file", onCreateFile);
    window.addEventListener("kryton:create-root-folder", onCreateFolderEvt);
    return () => {
      window.removeEventListener("kryton:create-root-file", onCreateFile);
      window.removeEventListener("kryton:create-root-folder", onCreateFolderEvt);
    };
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCreate = useCallback((_type: "file" | "folder", parentPath: string) => {
    setCreating({ type: _type, parentPath });
    setNewName("");
  }, []);

  const submitCreate = useCallback(async () => {
    if (!creating || !newName.trim()) {
      setCreating(null);
      return;
    }
    const fullPath = creating.parentPath ? `${creating.parentPath}/${newName.trim()}` : newName.trim();
    if (creating.type === "file") {
      await onCreateNote(fullPath);
    } else {
      await onCreateFolder(fullPath);
      setExpanded((prev) => new Set(prev).add(fullPath));
    }
    setCreating(null);
    setNewName("");
  }, [creating, newName, onCreateNote, onCreateFolder]);

  const handleRename = useCallback(async () => {
    if (!renaming || !newName.trim()) {
      setRenaming(null);
      return;
    }
    const parts = renaming.path.split("/");
    parts[parts.length - 1] =
      renaming.type === "file" ? newName.trim().replace(/\.md$/, "") + ".md" : newName.trim();
    const newPath = parts.join("/");
    if (renaming.type === "file") {
      await onRenameNote(renaming.path, newPath);
    } else {
      await onRenameFolder(renaming.path, newPath);
    }
    setRenaming(null);
    setNewName("");
  }, [renaming, newName, onRenameNote, onRenameFolder]);

  const handleDeleteConfirmed = useCallback(
    async (node: FileTreeNode) => {
      setPendingDelete(null);
      if (node.type === "file") {
        await onDeleteNote(node.path);
      } else {
        await onDeleteFolder(node.path);
      }
    },
    [onDeleteNote, onDeleteFolder],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileTreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    const id = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [contextMenu]);

  const handleDragStart = useCallback((e: React.DragEvent, node: FileTreeNode) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.path);
    // Refs first (sync) so the very next dragover sees the active drag;
    // setState is async and would race the first event.
    draggedPathRef.current = node.path;
    draggedTypeRef.current = node.type;
    setDraggedPath(node.path);
    setDraggedType(node.type);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, node: FileTreeNode) => {
      if (node.type !== "folder") return;
      const dPath = draggedPathRef.current;
      const dType = draggedTypeRef.current;
      if (!dPath) return;
      if (dType === "folder") {
        const normalizedDragged = dPath.endsWith("/") ? dPath : dPath + "/";
        if (node.path === dPath || node.path.startsWith(normalizedDragged)) return;
      }
      const draggedParent = dPath.includes("/")
        ? dPath.substring(0, dPath.lastIndexOf("/"))
        : "";
      if (node.path === draggedParent) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDragOverPath(node.path);
    },
    [],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetNode: FileTreeNode) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);
      const sourcePath = e.dataTransfer.getData("text/plain") || draggedPathRef.current;
      const dType = draggedTypeRef.current;
      if (!sourcePath || targetNode.type !== "folder") return;
      if (sourcePath === targetNode.path) return;
      if (dType === "folder") {
        const normalizedDragged = sourcePath.endsWith("/") ? sourcePath : sourcePath + "/";
        if (targetNode.path.startsWith(normalizedDragged)) return;
      }
      const sourceParent = sourcePath.includes("/")
        ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
        : "";
      if (targetNode.path === sourceParent) return;
      const filename = sourcePath.split("/").pop()!;
      const newPath = `${targetNode.path}/${filename}`;
      if (dType === "folder") {
        await onRenameFolder(sourcePath, newPath);
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(newPath);
          return next;
        });
      } else {
        await onRenameNote(sourcePath, newPath);
      }
      setExpanded((prev) => new Set(prev).add(targetNode.path));
    },
    [onRenameNote, onRenameFolder],
  );

  /** Drop on the tree's empty area → move source to the root. */
  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    const dPath = draggedPathRef.current;
    if (!dPath) return;
    // Already at root → no-op (don't accept the drop)
    if (!dPath.includes("/")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Clear any folder hover highlight so the user sees we'll drop to root.
    setDragOverPath(null);
  }, []);

  const handleRootDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const sourcePath = e.dataTransfer.getData("text/plain") || draggedPathRef.current;
      const dType = draggedTypeRef.current;
      if (!sourcePath || !sourcePath.includes("/")) return;
      const filename = sourcePath.split("/").pop()!;
      if (dType === "folder") {
        await onRenameFolder(sourcePath, filename);
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(sourcePath);
          next.add(filename);
          return next;
        });
      } else {
        await onRenameNote(sourcePath, filename);
      }
      setDragOverPath(null);
    },
    [onRenameNote, onRenameFolder],
  );

  const handleDragEnd = useCallback(() => {
    draggedPathRef.current = null;
    draggedTypeRef.current = null;
    setDraggedPath(null);
    setDraggedType(null);
    setDragOverPath(null);
  }, []);

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

  // SidebarNode is memoized to prevent full reconstruction on each parent render
  const SidebarNode = useMemo(
    () =>
      memo(function SidebarNode({ node, depth }: { node: FileTreeNode; depth: number }) {
        const isActive = node.type === "file" && node.path === activeNotePath;
        const isExpanded = expanded.has(node.path);
        const isRenaming = renaming?.path === node.path;
        const isStarred = node.type === "file" && starredPaths.has(node.path);
        const isDragging = node.path === draggedPath;
        const isDragOver = node.type === "folder" && node.path === dragOverPath;
        const displayName = node.type === "file" ? node.name.replace(/\.md$/, "") : node.name;

        return (
          <div>
            <button
              draggable
              role="treeitem"
              aria-expanded={node.type === "folder" ? isExpanded : undefined}
              tabIndex={0}
              className={cn(
                "group w-full flex items-center gap-2 py-1 text-sm rounded-md mx-1 transition-colors duration-100 kryton-tree-row relative",
                isDragging && "opacity-50",
                isDragOver && "kryton-tree-row--dragover",
                isActive && "kryton-tree-row--active",
              )}
              style={{
                paddingLeft: `${depth * 14 + 8}px`,
                paddingRight: 8,
                color: isActive ? "var(--fg)" : "var(--fg-1)",
                background: isActive ? "var(--accent-soft)" : "transparent",
              }}
              onClick={() => {
                if (node.type === "folder") toggleExpand(node.path);
                else onSelect(node.path);
              }}
              onContextMenu={(e) => handleContextMenu(e, node)}
              onDragStart={(e) => handleDragStart(e, node)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, node)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, node)}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Active 2px accent left bar — per prototype Row */}
              {isActive && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 4,
                    bottom: 4,
                    width: 2,
                    background: "var(--accent)",
                    borderRadius: 2,
                  }}
                />
              )}
              {node.type === "folder" ? (
                isExpanded ? (
                  <FolderOpen
                    size={14}
                    aria-hidden="true"
                    className="flex-shrink-0"
                    style={{ color: "var(--fg-3)" }}
                  />
                ) : (
                  <Folder
                    size={14}
                    aria-hidden="true"
                    className="flex-shrink-0"
                    style={{ color: "var(--fg-3)" }}
                  />
                )
              ) : (
                <FileText
                  size={13}
                  aria-hidden="true"
                  className="flex-shrink-0"
                  style={{ color: isActive ? "var(--accent)" : "var(--fg-3)" }}
                />
              )}
              {isRenaming ? (
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="flex-1 bg-white dark:bg-gray-800 border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-violet-500"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  }}
                >
                  {displayName}
                </span>
              )}
              {node.type === "folder" && node.children && (
                <span
                  className="mono"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--fg-4)",
                    flexShrink: 0,
                  }}
                >
                  {countLeaves(node)}
                </span>
              )}
              {node.type === "file" && !isRenaming && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleStar(node.path);
                  }}
                  className={cn(
                    "p-0.5 rounded transition-opacity",
                    isStarred
                      ? "text-yellow-500 opacity-100"
                      : "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-yellow-500",
                  )}
                  title={isStarred ? "Unstar" : "Star"}
                >
                  <Star size={13} aria-hidden="true" fill={isStarred ? "currentColor" : "none"} />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu({
                    x: e.currentTarget.getBoundingClientRect().right,
                    y: e.currentTarget.getBoundingClientRect().top,
                    node,
                  });
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300/50 dark:hover:bg-gray-600/50 transition-opacity"
                aria-label="More options"
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            </button>
            {node.type === "folder" && isExpanded && node.children && (
              <div>
                {creating && creating.parentPath === node.path && (
                  <div
                    className="flex items-center gap-1 px-2 py-1 mx-1"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    {creating.type === "file" ? (
                      <FileText size={15} className="text-gray-400" />
                    ) : (
                      <Folder size={15} className="text-gray-400" />
                    )}
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onBlur={submitCreate}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitCreate();
                        if (e.key === "Escape") setCreating(null);
                      }}
                      placeholder={creating.type === "file" ? "Note name..." : "Folder name..."}
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
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeNotePath,
      expanded,
      renaming,
      starredPaths,
      draggedPath,
      dragOverPath,
      newName,
      toggleExpand,
      onSelect,
      handleContextMenu,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleRename,
      onToggleStar,
      creating,
      submitCreate,
    ],
  );

  return (
    <div className="h-full flex flex-col" onClick={() => setContextMenu(null)}>
      {/* File tree */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {creating && creating.parentPath === "" && (
          <div className="flex items-center gap-1 px-2 py-1 mx-1" style={{ paddingLeft: "8px" }}>
            {creating.type === "file" ? (
              <FileText size={15} className="text-gray-400" />
            ) : (
              <Folder size={15} className="text-gray-400" />
            )}
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={submitCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreate();
                if (e.key === "Escape") setCreating(null);
              }}
              placeholder={creating.type === "file" ? "Note name..." : "Folder name..."}
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
            type="button"
            onClick={() => setSharedCollapsed((prev) => !prev)}
            className="w-full px-3 py-1.5 flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronRight
              size={12}
              className={cn(
                "text-gray-400 transition-transform duration-150",
                sharedCollapsed ? "" : "rotate-90",
              )}
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
                      {notes[0]?.ownerName}
                    </span>
                  </div>
                  {notes.map((note) => {
                    const sharedId = `shared:${note.ownerUserId}:${note.path}`;
                    const fileName =
                      note.path.split("/").pop()?.replace(/\.md$/, "") || note.path;
                    return (
                      <button
                        key={sharedId}
                        type="button"
                        className={cn(
                          "group w-full flex items-center gap-1 px-2 py-1 text-sm rounded-md mx-1 transition-colors duration-100",
                          sharedId === activeNotePath
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/40",
                        )}
                        style={{ paddingLeft: "20px" }}
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

      {/* Context menu portaled to body */}
      {contextMenu &&
        createPortal(
          <div
            className="fixed bg-white dark:bg-gray-800 border rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 99999 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.node.type === "folder" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleCreate("file", contextMenu.node.path);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <Plus size={14} /> New note here
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleCreate("folder", contextMenu.node.path);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <FolderPlus size={14} /> New folder here
                </button>
                {onShare && (
                  <button
                    type="button"
                    onClick={() => {
                      onShare(contextMenu.node.path, true);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    <Share2 size={14} /> Share folder...
                  </button>
                )}
                <div className="border-t my-1" />
              </>
            )}
            {contextMenu.node.type === "file" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onToggleStar(contextMenu.node.path);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <Star size={14} /> {starredPaths.has(contextMenu.node.path) ? "Unstar" : "Star"}
                </button>
                {onShare && (
                  <button
                    type="button"
                    onClick={() => {
                      onShare(contextMenu.node.path, false);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    <Share2 size={14} /> Share...
                  </button>
                )}
                <div className="border-t my-1" />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                const name =
                  contextMenu.node.type === "file"
                    ? contextMenu.node.name.replace(/\.md$/, "")
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Delete &quot;{contextMenu.node.name}&quot;?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteConfirmed(contextMenu.node);
                      setContextMenu(null);
                    }}
                    className="flex-1 text-xs bg-red-500 text-white rounded px-2 py-1 hover:bg-red-600 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="flex-1 text-xs border rounded px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(contextMenu.node);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
