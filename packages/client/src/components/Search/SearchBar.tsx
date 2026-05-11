import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { createPortal } from 'react-dom';
import { SearchInput, SearchResults, type SearchResultItem } from '@azrtydxb/ui';
import { api, SearchResult, type SearchMode } from '../../lib/api';
import { useSemanticReady } from '../../hooks/useSemanticReady';

interface SearchBarProps {
  onSelect: (path: string) => void;
  inputRef?: React.MutableRefObject<HTMLInputElement | undefined>;
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}

function ModeButton({ active, onClick, children, testId }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      className="flex items-center text-xs font-medium transition-colors"
      style={{
        padding: '4px 8px',
        borderRadius: 5,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-3)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.color = 'var(--fg)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-3)';
        }
      }}
    >
      {children}
    </button>
  );
}

/**
 * Header search bar — wraps @azrtydxb/ui SearchInput + SearchResults.
 * Renders the dropdown via a portal so it escapes the header's stacking context.
 *
 * Supports a lexical|semantic mode toggle. Semantic mode polls
 * `/api/search/semantic/ready` and shows a "warming up…" indicator while the
 * embedder is offline. When the embedder is ready but has pending jobs, shows
 * a small "N notes still indexing" hint below the input.
 */
export function SearchBar({ onSelect, inputRef: externalRef }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<SearchMode>('lexical');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const ready = useSemanticReady(mode === 'semantic');
  const semanticReady = mode === 'semantic' && ready?.ready === true;
  const semanticWarming = mode === 'semantic' && ready !== null && !ready.ready;
  const pendingJobs = ready?.pendingJobs ?? 0;

  const doSearch = useCallback(async (q: string, m: SearchMode, gated: boolean) => {
    if (q.trim().length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (m === 'semantic' && !gated) {
      // Semantic mode but embedder not ready — surface the warming state instead.
      setResults([]);
      setOpen(true);
      return;
    }
    setLoading(true);
    try {
      const res = await api.search(q, m);
      setResults(res);
      setOpen(true);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback((value: string, m: SearchMode, gated: boolean) => {
    doSearch(value, m, gated);
  }, 200);

  const handleChange = useCallback((value: string) => {
    setQuery(value);
    debouncedSearch(value, mode, mode !== 'semantic' || semanticReady);
  }, [debouncedSearch, mode, semanticReady]);

  // Re-run the query when the mode flips, or when the embedder transitions
  // from warming-up to ready. IIFE pattern keeps the effect free of direct
  // setState calls (set-state-in-effect rule, pinned to 7.1.1).
  useEffect(() => {
    if (query.trim().length === 0) return;
    const gated = mode !== 'semantic' || semanticReady;
    void (async () => {
      await doSearch(query, mode, gated);
    })();
  }, [mode, semanticReady, query, doSearch]);

  const handleSelect = useCallback((result: SearchResultItem) => {
    const path = result.isShared && result.ownerUserId
      ? `shared:${result.ownerUserId}:${result.path}`
      : result.path;
    onSelect(path);
    setQuery('');
    setResults([]);
    setOpen(false);
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
      const selected = results[selectedIndex];
      if (selected) handleSelect(selected);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [open, results, selectedIndex, handleSelect]);

  const updateDropdownPos = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (open) {
      updateDropdownPos();
      window.addEventListener('resize', updateDropdownPos);
      window.addEventListener('scroll', updateDropdownPos, true);
      return () => {
        window.removeEventListener('resize', updateDropdownPos);
        window.removeEventListener('scroll', updateDropdownPos, true);
      };
    }
  }, [open, updateDropdownPos]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showIndexingHint = mode === 'semantic' && semanticReady && pendingJobs > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <SearchInput
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (results.length > 0 || semanticWarming) setOpen(true); }}
        loading={loading}
        placeholder="Search notes... (Ctrl+K)"
        inputRef={externalRef}
      />

      <div className="flex items-center justify-between gap-2 mt-1 px-1">
        <div className="flex items-center gap-1">
          <ModeButton
            active={mode === 'lexical'}
            onClick={() => setMode('lexical')}
            testId="search-mode-lexical"
          >
            lexical
          </ModeButton>
          <ModeButton
            active={mode === 'semantic'}
            onClick={() => setMode('semantic')}
            testId="search-mode-semantic"
          >
            semantic
          </ModeButton>
        </div>
        {showIndexingHint && (
          <span
            data-testid="search-indexing-hint"
            className="text-[11px]"
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              color: 'var(--fg-3)',
            }}
          >
            ⌛ {pendingJobs} {pendingJobs === 1 ? 'note' : 'notes'} still indexing
          </span>
        )}
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 99999,
          }}
          className="bg-white dark:bg-gray-800 border rounded-lg shadow-lg overflow-hidden"
        >
          {semanticWarming ? (
            <div
              data-testid="search-warming-up"
              className="px-3 py-2 text-sm"
              style={{
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                color: 'var(--fg-3)',
              }}
            >
              ⌛ warming up…
            </div>
          ) : (
            <SearchResults
              results={results}
              loading={loading}
              query={query}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              onHover={setSelectedIndex}
            />
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
