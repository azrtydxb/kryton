import { useState, useEffect, useRef, useCallback } from 'react';
import { List, ChevronRight } from 'lucide-react';

interface Heading {
  level: number;
  text: string;
  line: number;
}

interface OutlinePaneProps {
  content: string;
  onJumpToLine: (line: number) => void;
}

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,
      });
    }
  }
  return headings;
}

export function OutlinePane({ content, onJumpToLine }: OutlinePaneProps) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setHeadings(extractHeadings(content));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content]);

  const toggleCollapse = useCallback((line: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  // Determine which headings are visible (not hidden by collapsed parents)
  const visibleHeadings = headings.filter((heading, idx) => {
    // Check if any ancestor heading is collapsed
    for (let i = idx - 1; i >= 0; i--) {
      if (headings[i].level < heading.level && collapsed.has(headings[i].line)) {
        return false;
      }
      if (headings[i].level < heading.level) break;
    }
    return true;
  });

  // Build realIdxMap before the render loop to avoid O(n²) indexOf calls
  const realIdxMap = new Map<Heading, number>(headings.map((h, i) => [h, i]));

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b">
        <List size={15} className="text-gray-400" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Outline</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {visibleHeadings.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            No headings found
          </div>
        ) : (
          visibleHeadings.map((heading, idx) => {
            const realIdx = realIdxMap.get(heading) ?? 0;
            const hasKids = (() => {
              for (let i = realIdx + 1; i < headings.length; i++) {
                if (headings[i].level <= heading.level) break;
                if (headings[i].level > heading.level) return true;
              }
              return false;
            })();
            const isCollapsed = collapsed.has(heading.line);

            return (
              <div
                key={`${heading.line}-${idx}`}
                role="group"
                style={{ display: 'flex', paddingLeft: `${(heading.level - 1) * 16 + 8}px` }}
                className="w-full flex items-center gap-1 px-2 py-1 mx-1 rounded-md text-sm hover:bg-gray-200/60 dark:hover:bg-gray-700/40 text-gray-700 dark:text-gray-300 transition-colors duration-100"
              >
                {hasKids ? (
                  <button
                    onClick={() => toggleCollapse(heading.line)}
                    className="flex-shrink-0 p-0.5"
                    aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                  >
                    <ChevronRight
                      size={12}
                      className={`text-gray-400 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                    />
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <button
                  className={`truncate text-left flex-1 ${heading.level === 1 ? 'font-semibold' : heading.level === 2 ? 'font-medium' : ''}`}
                  onClick={() => onJumpToLine(heading.line)}
                >
                  {heading.text}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
