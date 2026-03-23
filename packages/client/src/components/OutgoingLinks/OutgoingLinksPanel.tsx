import { useState, useMemo } from 'react';
import { ChevronRight, ArrowDownRight, AlertCircle } from 'lucide-react';
import { FileNode } from '../../lib/api';

interface OutgoingLinksPanelProps {
  content: string;
  allNotes: FileNode[];
  onNoteSelect: (path: string) => void;
  onCreateNote: (path: string) => void;
}

interface OutgoingLink {
  name: string;
  path: string | null;
  exists: boolean;
}

function collectNotePaths(nodes: FileNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'file') {
      const nameWithoutExt = node.name.replace(/\.md$/, '');
      const pathWithoutExt = node.path.replace(/\.md$/, '');
      map.set(nameWithoutExt.toLowerCase(), node.path);
      map.set(pathWithoutExt.toLowerCase(), node.path);
    }
    if (node.children) {
      for (const [key, val] of collectNotePaths(node.children)) {
        map.set(key, val);
      }
    }
  }
  return map;
}

function extractLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      links.push(name);
    }
  }
  return links;
}

export function OutgoingLinksPanel({ content, allNotes, onNoteSelect, onCreateNote }: OutgoingLinksPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const notePathMap = useMemo(() => collectNotePaths(allNotes), [allNotes]);

  const outgoingLinks: OutgoingLink[] = useMemo(() => {
    const linkNames = extractLinks(content);
    return linkNames.map(name => {
      const lower = name.toLowerCase();
      const foundPath = notePathMap.get(lower);
      return {
        name,
        path: foundPath || null,
        exists: !!foundPath,
      };
    });
  }, [content, notePathMap]);

  const brokenCount = useMemo(() => outgoingLinks.filter(l => !l.exists).length, [outgoingLinks]);

  if (outgoingLinks.length === 0) return null;

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
        <ArrowDownRight size={14} />
        Outgoing Links
        <span className="ml-auto text-xs font-normal bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 py-0.5">
          {outgoingLinks.length}
        </span>
        {brokenCount > 0 && (
          <span className="text-xs font-normal bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full px-1.5 py-0.5">
            {brokenCount} broken
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          <ul className="space-y-0.5">
            {outgoingLinks.map((link) => (
              <li key={link.name} className="flex items-center gap-1.5">
                {link.exists ? (
                  <button
                    onClick={() => link.path && onNoteSelect(link.path)}
                    className="text-sm text-blue-500 dark:text-blue-400 hover:underline truncate text-left py-0.5"
                    title={link.path || link.name}
                  >
                    {link.name}
                  </button>
                ) : (
                  <button
                    onClick={() => onCreateNote(link.name)}
                    className="text-sm text-red-500 dark:text-red-400 hover:underline truncate text-left py-0.5 flex items-center gap-1"
                    title={`Create "${link.name}"`}
                  >
                    <AlertCircle size={12} />
                    {link.name}
                    <span className="text-xs text-gray-400">(create)</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
