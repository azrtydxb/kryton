import { useEffect, useState, useMemo } from 'react';
import { api } from '../../lib/api';
import { parseDataviewQuery } from './parseDataviewQuery';

interface DataviewResult {
  title: string;
  path: string;
  tags: string[];
}

export function DataviewBlock({ query, onLinkClick }: { query: string; onLinkClick: (name: string) => void }) {
  const [results, setResults] = useState<DataviewResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDataviewQuery(query), [query]);

  useEffect(() => {
    if (!parsed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard before async work
      setError('Invalid dataview query');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        let notes: DataviewResult[];

        if (parsed!.fromTag) {
          const tagNotes = await api.getNotesByTag(parsed!.fromTag);
          notes = tagNotes.map(n => ({
            title: n.title,
            path: n.notePath,
            tags: [parsed!.fromTag!],
          }));
        } else {
          const searchResults = await api.search('');
          notes = searchResults.map(r => ({
            title: r.title,
            path: r.path,
            tags: r.tags,
          }));
        }

        // Apply WHERE filter
        if (parsed!.whereField && parsed!.whereValue) {
          const field = parsed!.whereField;
          const value = parsed!.whereValue;
          notes = notes.filter(n => {
            if (field === 'tags' || field === 'tag') {
              return n.tags.some(t => t.toLowerCase() === value.toLowerCase());
            }
            if (field === 'title') {
              return n.title.toLowerCase().includes(value.toLowerCase());
            }
            return true;
          });
        }

        // Apply SORT
        if (parsed!.sortField) {
          const dir = parsed!.sortDir === 'DESC' ? -1 : 1;
          notes.sort((a, b) => {
            return a.title.localeCompare(b.title) * dir;
          });
        }

        if (!cancelled) {
          setResults(notes);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to execute query');
          setLoading(false);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [parsed]);

  if (error) {
    return <div className="text-red-500 text-sm p-2 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>;
  }

  if (loading) {
    return <div className="text-gray-400 text-sm p-2">Running query...</div>;
  }

  if (results.length === 0) {
    return <div className="text-gray-400 text-sm p-2">No results</div>;
  }

  if (parsed?.type === 'table') {
    return (
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Note</th>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Path</th>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Tags</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.path}>
              <td className="border px-3 py-2 text-sm">
                <button onClick={() => onLinkClick(r.title)} className="text-violet-500 hover:underline">{r.title}</button>
              </td>
              <td className="border px-3 py-2 text-sm text-gray-500">{r.path}</td>
              <td className="border px-3 py-2 text-sm text-gray-500">{r.tags.map(t => `#${t}`).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <ul className="list-disc pl-6 mb-4">
      {results.map(r => (
        <li key={r.path} className="mb-1">
          <button onClick={() => onLinkClick(r.title)} className="text-violet-500 hover:underline text-sm">{r.title}</button>
          <span className="text-xs text-gray-400 ml-2">{r.path}</span>
        </li>
      ))}
    </ul>
  );
}
