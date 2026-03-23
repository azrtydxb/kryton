import { useState, useRef, useCallback, useEffect } from 'react';
import { Search, FileText, X } from 'lucide-react';
import { api, SearchResult } from '../../lib/api';

interface SearchBarProps {
  onSelect: (path: string) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.search(q);
      setResults(res);
      setOpen(true);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  }, [doSearch]);

  const handleSelect = useCallback((path: string) => {
    onSelect(path);
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }, [onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[selectedIndex].path);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [open, results, selectedIndex, handleSelect]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Ctrl/Cmd+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search notes... (Ctrl+K)"
          className="w-full bg-gray-100 dark:bg-surface-800 border-0 rounded-md pl-8 pr-8 py-1.5 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border rounded-lg shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-500">Searching...</div>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <div className="px-3 py-2 text-sm text-gray-500">No results found</div>
          )}
          {results.map((result, idx) => (
            <button
              key={result.path}
              onClick={() => handleSelect(result.path)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                idx === selectedIndex
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <FileText size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{result.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{result.path}</div>
                {result.snippet && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">
                    {result.snippet}
                  </div>
                )}
                {result.tags.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {result.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-400">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
