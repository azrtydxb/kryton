import { useState } from 'react';
import { Star, ChevronRight } from 'lucide-react';

interface FavoritesPaneProps {
  starredPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggleStar: (path: string) => void;
}

export function FavoritesPane({ starredPaths, onSelect, onToggleStar }: FavoritesPaneProps) {
  const [collapsed, setCollapsed] = useState(false);

  const paths = Array.from(starredPaths);

  return (
    <div className="border-b">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full px-3 py-1.5 flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`text-gray-400 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-500 uppercase tracking-wider flex items-center gap-1">
          <Star size={11} fill="currentColor" />
          Favorites
          {paths.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-yellow-500/70 dark:text-yellow-500/60">
              ({paths.length})
            </span>
          )}
        </span>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {paths.length === 0 ? (
            <p className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
              No favorites yet. Star notes with Ctrl+Shift+S
            </p>
          ) : (
            paths.map((path) => {
              const parts = path.split('/');
              const fileName = parts[parts.length - 1].replace(/\.md$/, '');
              const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;

              return (
                <div
                  key={path}
                  className="group flex items-center gap-1.5 px-2 py-1 mx-1 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/40 transition-colors duration-100"
                >
                  <button
                    className="flex-1 flex items-center gap-1.5 min-w-0 text-left"
                    onClick={() => onSelect(path)}
                  >
                    <Star size={13} className="flex-shrink-0 text-yellow-500" fill="currentColor" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-sm leading-tight">{fileName}</div>
                      {dirPath && (
                        <div className="truncate text-[10px] text-gray-400 dark:text-gray-500 leading-tight mt-0.5">
                          {dirPath}
                        </div>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => onToggleStar(path)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-yellow-500 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-opacity flex-shrink-0"
                    title="Unstar"
                    aria-label="Unstar note"
                  >
                    <Star size={13} fill="currentColor" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
