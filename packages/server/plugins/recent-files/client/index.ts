import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback } = React;

const STORAGE_PREFIX = 'mnemo-recent-files-';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function loadRecent(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(userId: string, items: string[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // ignore storage errors
  }
}

function addRecent(userId: string, path: string, max: number): string[] {
  const items = loadRecent(userId).filter((p) => p !== path);
  items.unshift(path);
  const trimmed = items.slice(0, max);
  saveRecent(userId, trimmed);
  return trimmed;
}

function noteLabel(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1] ?? path;
  return filename.replace(/\.md$/i, '');
}

function notePath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function activate(api: ClientPluginAPI): void {
  function RecentFilesPanel(): any {
    const user = api.context.useCurrentUser();
    const currentNote = api.context.useCurrentNote();
    const rawMax = api.context.usePluginSettings('maxItems');
    const maxItems = typeof rawMax === 'number' && rawMax > 0 ? rawMax : 20;

    const userId = user?.id ?? 'anonymous';

    const [items, setItems] = useState<string[]>(() => loadRecent(userId));

    // Track note opens
    useEffect(() => {
      if (!currentNote?.path) return;
      const updated = addRecent(userId, currentNote.path, maxItems);
      setItems(updated);
    }, [currentNote?.path, userId, maxItems]);

    const handleNavigate = useCallback((path: string) => {
      api.api.fetch(`/notes/${encodeURIComponent(path)}`).catch(() => {});
    }, []);

    const handleClear = useCallback(() => {
      saveRecent(userId, []);
      setItems([]);
    }, [userId]);

    if (items.length === 0) {
      return h('div', { className: 'flex flex-col h-full' },
        h('div', { className: 'flex-1 flex items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500' },
          'No recently opened files.'
        )
      );
    }

    return h('div', { className: 'flex flex-col h-full' },
      h('ul', { className: 'flex-1 overflow-y-auto py-1' },
        items.map((path: string) =>
          h('li', { key: path },
            h('button', {
              onClick: () => handleNavigate(path),
              className: 'w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group',
              title: path,
            },
              h('span', { className: 'block text-sm text-gray-800 dark:text-gray-200 truncate' },
                noteLabel(path)
              ),
              h('span', { className: 'block text-xs text-gray-400 dark:text-gray-500 truncate' },
                notePath(path)
              )
            )
          )
        )
      ),
      h('div', { className: 'px-3 py-2 border-t border-gray-200 dark:border-gray-700' },
        h('button', {
          onClick: handleClear,
          className: 'text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors',
        }, 'Clear History')
      )
    );
  }

  api.ui.registerSidebarPanel(RecentFilesPanel, {
    id: 'recent-files',
    title: 'Recent Files',
    icon: 'clock',
    order: 10,
  });
}

export function deactivate(): void {
  // nothing to clean up
}
