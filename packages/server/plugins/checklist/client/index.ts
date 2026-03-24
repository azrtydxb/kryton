import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback } = React;

interface ChecklistItem {
  text: string;
  checked: boolean;
  lineIndex: number;
}

interface NoteChecklist {
  path: string;
  items: ChecklistItem[];
}

const CHECKBOX_RE = /^[-*]\s+\[( |x)\]\s+(.+)$/i;

function parseCheckboxes(content: string): ChecklistItem[] {
  return content
    .split('\n')
    .map((line, lineIndex) => {
      const match = CHECKBOX_RE.exec(line.trim());
      if (!match) return null;
      return {
        text: match[2].trim(),
        checked: match[1].toLowerCase() === 'x',
        lineIndex,
      } satisfies ChecklistItem;
    })
    .filter((item): item is ChecklistItem => item !== null);
}

function noteLabel(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1] ?? path;
  return filename.replace(/\.md$/i, '');
}

export function activate(api: ClientPluginAPI): void {
  function ChecklistPanel(): any {
    const showCompletedSetting = api.context.usePluginSettings('showCompleted');
    const showCompleted = showCompletedSetting !== false;

    const [notes, setNotes] = useState<NoteChecklist[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchChecklists = useCallback(() => {
      setLoading(true);
      setError(null);

      // Search for notes containing unchecked boxes first, then also checked
      api.api
        .fetch('/search?q=%2D+%5B+%5D')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((results: Array<{ path: string; content: string }>) => {
          if (!Array.isArray(results)) return [];
          return results
            .map((note) => ({
              path: note.path,
              items: parseCheckboxes(note.content ?? ''),
            }))
            .filter((n) => n.items.length > 0);
        })
        .then((parsed) => {
          setNotes(parsed);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message ?? 'Failed to load checklists');
          setLoading(false);
        });
    }, []);

    useEffect(() => {
      fetchChecklists();
    }, [fetchChecklists]);

    const handleNavigate = useCallback((path: string) => {
      api.api.fetch(`/notes/${encodeURIComponent(path)}`).catch(() => {});
    }, []);

    if (loading) {
      return h('div', { className: 'flex items-center justify-center h-full p-4 text-sm text-gray-400 dark:text-gray-500' },
        'Loading checklists…'
      );
    }

    if (error) {
      return h('div', { className: 'flex flex-col items-center justify-center h-full p-4 gap-2' },
        h('span', { className: 'text-sm text-red-400' }, 'Error: ' + error),
        h('button', {
          onClick: fetchChecklists,
          className: 'text-xs text-gray-400 hover:text-gray-200 transition-colors',
        }, 'Retry')
      );
    }

    const visibleNotes = notes
      .map((note: NoteChecklist) => ({
        ...note,
        items: showCompleted ? note.items : note.items.filter((i: ChecklistItem) => !i.checked),
      }))
      .filter((note: NoteChecklist) => note.items.length > 0);

    if (visibleNotes.length === 0) {
      return h('div', { className: 'flex flex-col items-center justify-center h-full p-4 gap-2' },
        h('span', { className: 'text-sm text-gray-400 dark:text-gray-500' },
          notes.length === 0 ? 'No checklist items found.' : 'All items completed.'
        ),
        h('button', {
          onClick: fetchChecklists,
          className: 'text-xs text-gray-400 hover:text-violet-400 transition-colors',
        }, 'Refresh')
      );
    }

    return h('div', { className: 'flex flex-col h-full' },
      h('div', { className: 'flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-700' },
        h('span', { className: 'text-xs text-gray-400 dark:text-gray-500' },
          `${visibleNotes.reduce((acc: number, n: NoteChecklist) => acc + n.items.length, 0)} item(s)`
        ),
        h('button', {
          onClick: fetchChecklists,
          className: 'text-xs text-gray-400 hover:text-violet-400 dark:hover:text-violet-400 transition-colors',
          title: 'Refresh',
        }, '↻')
      ),
      h('ul', { className: 'flex-1 overflow-y-auto py-1' },
        visibleNotes.map((note: NoteChecklist) =>
          h('li', { key: note.path, className: 'mb-2' },
            // Note header
            h('button', {
              onClick: () => handleNavigate(note.path),
              className: 'w-full text-left px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-violet-500 dark:hover:text-violet-400 uppercase tracking-wide truncate transition-colors',
              title: note.path,
            }, noteLabel(note.path)),
            // Checklist items
            h('ul', null,
              note.items.map((item: ChecklistItem, idx: number) =>
                h('li', { key: `${note.path}-${idx}-${item.lineIndex}` },
                  h('button', {
                    onClick: () => handleNavigate(note.path),
                    className: 'w-full text-left flex items-start gap-2 px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group',
                    title: `${noteLabel(note.path)}: ${item.text}`,
                  },
                    h('span', {
                      className: 'mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border ' +
                        (item.checked
                          ? 'bg-violet-500 border-violet-500 text-white flex items-center justify-center'
                          : 'border-gray-400 dark:border-gray-500'),
                    },
                      item.checked
                        ? h('span', { className: 'text-[9px] leading-none' }, '✓')
                        : null
                    ),
                    h('span', {
                      className: 'text-sm flex-1 min-w-0 break-words ' +
                        (item.checked
                          ? 'line-through text-gray-400 dark:text-gray-500'
                          : 'text-gray-700 dark:text-gray-300'),
                    }, item.text)
                  )
                )
              )
            )
          )
        )
      )
    );
  }

  api.ui.registerSidebarPanel(ChecklistPanel, {
    id: 'checklist',
    title: 'Checklist',
    icon: 'check-square',
    order: 30,
  });
}

export function deactivate(): void {
  // nothing to clean up
}
