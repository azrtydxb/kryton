import { useState, useEffect, useCallback } from 'react';
import { api, BacklinkData } from '../../lib/api';
import { ChevronRight, ArrowUpLeft } from 'lucide-react';

interface BacklinksPanelProps {
  notePath: string;
  onNoteSelect: (path: string) => void;
}

export function BacklinksPanel({ notePath, onNoteSelect }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkData[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchBacklinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBacklinks(notePath);
      setBacklinks(data);
    } catch {
      setBacklinks([]);
    } finally {
      setLoading(false);
    }
  }, [notePath]);

  useEffect(() => {
    fetchBacklinks();
  }, [fetchBacklinks]);

  return (
    <div className="border-t bg-gray-50/50 dark:bg-surface-900/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <ArrowUpLeft size={14} />
        Backlinks
        {backlinks.length > 0 && (
          <span className="ml-auto text-xs font-normal bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 py-0.5">
            {backlinks.length}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {loading ? (
            <p className="text-xs text-gray-400 py-1">Loading...</p>
          ) : backlinks.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">No backlinks found</p>
          ) : (
            <ul className="space-y-0.5">
              {backlinks.map((link) => (
                <li key={link.path}>
                  <button
                    onClick={() => onNoteSelect(link.path)}
                    className="text-sm text-violet-500 dark:text-violet-400 hover:underline truncate block w-full text-left py-0.5"
                    title={link.path}
                  >
                    {link.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
