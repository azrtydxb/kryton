import * as React from "react";
import { useState, useCallback } from "react";
import { Trash2, RotateCcw, XCircle, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

export interface TrashItem {
  /** The original file path (e.g. "notes/foo.md") */
  path: string;
}

export interface TrashListProps {
  items: TrashItem[];
  /** Loading key: null = idle, 'empty' = emptying all, 'restore:<path>' or 'delete:<path>' for per-item */
  loadingKey?: string | null;
  onRestore: (item: TrashItem) => Promise<void> | void;
  onPermanentDelete: (item: TrashItem) => Promise<void> | void;
  onEmptyTrash: () => Promise<void> | void;
  className?: string;
}

export function TrashList({
  items,
  loadingKey = null,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  className,
}: TrashListProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingEmptyTrash, setPendingEmptyTrash] = useState(false);

  const handleEmptyTrash = useCallback(async () => {
    if (items.length === 0) return;
    setPendingEmptyTrash(false);
    await onEmptyTrash();
  }, [items.length, onEmptyTrash]);

  return (
    <div className={cn("border-t", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="w-full px-3 py-1.5 flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-expanded={!collapsed}
      >
        <ChevronRight
          size={12}
          className={cn(
            "text-gray-400 transition-transform duration-150",
            collapsed ? "" : "rotate-90",
          )}
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
                const displayName =
                  item.path.split("/").pop()?.replace(/\.md$/, "") || item.path;
                const isRestoringThis = loadingKey === `restore:${item.path}`;
                const isDeletingThis = loadingKey === `delete:${item.path}`;
                const isConfirmingDelete = pendingDelete === item.path;

                return (
                  <div
                    key={item.path}
                    className="group flex flex-col px-2 py-1 mx-1 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <Trash2
                        size={13}
                        className="flex-shrink-0 text-gray-400 dark:text-gray-500"
                      />
                      <span
                        className="flex-1 truncate text-xs"
                        title={item.path}
                      >
                        {displayName}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRestore(item)}
                        disabled={
                          isRestoringThis ||
                          isDeletingThis ||
                          loadingKey === "empty"
                        }
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 disabled:opacity-40 transition-opacity"
                        title="Restore"
                        aria-label={`Restore ${displayName}`}
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDelete(
                            isConfirmingDelete ? null : item.path,
                          )
                        }
                        disabled={
                          isRestoringThis ||
                          isDeletingThis ||
                          loadingKey === "empty"
                        }
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 transition-opacity"
                        title="Delete permanently"
                        aria-label={`Delete ${displayName} permanently`}
                      >
                        <XCircle size={13} />
                      </button>
                    </div>
                    {isConfirmingDelete && (
                      <div className="mt-1 flex gap-1.5 pl-4">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDelete(null);
                            onPermanentDelete(item);
                          }}
                          className="text-[11px] bg-red-500 text-white rounded px-2 py-0.5 hover:bg-red-600 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          className="text-[11px] border rounded px-2 py-0.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="px-3 pt-1">
                {pendingEmptyTrash ? (
                  <div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Permanently delete all {items.length} note(s)?
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleEmptyTrash}
                        disabled={loadingKey === "empty"}
                        className="flex-1 text-[11px] bg-red-500 text-white rounded px-2 py-1 hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {loadingKey === "empty" ? "Emptying..." : "Delete All"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingEmptyTrash(false)}
                        className="flex-1 text-[11px] border rounded px-2 py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingEmptyTrash(true)}
                    disabled={loadingKey === "empty"}
                    className="w-full text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    Empty Trash
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
