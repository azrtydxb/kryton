import { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, Search } from 'lucide-react';
import { FileNode } from '../../lib/api';

interface QuickSwitcherProps {
  notes: FileNode[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

function collectFiles(nodes: FileNode[]): { path: string; name: string }[] {
  const files: { path: string; name: string }[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push({ path: node.path, name: node.name.replace(/\.md$/, '') });
    }
    if (node.children) {
      files.push(...collectFiles(node.children));
    }
  }
  return files;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function QuickSwitcher({ notes, onSelect, onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allFiles = collectFiles(notes);
  const filtered = query.trim()
    ? allFiles.filter(f => fuzzyMatch(query, f.name) || fuzzyMatch(query, f.path))
    : allFiles;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state on query change
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].path);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search notes..."
            className="w-full py-3 bg-transparent text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">No notes found</div>
          ) : (
            filtered.map((file, idx) => (
              <button
                key={file.path}
                onClick={() => { onSelect(file.path); onClose(); }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  idx === selectedIndex
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <FileText size={15} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{file.path}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
