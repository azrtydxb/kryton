/**
 * AllNotesView — flat browser of every note in the vault.
 *
 * Replaces the editor pane (the sidebar + graph rail stay mounted around it).
 * Two display modes (list / grid) and a sort dropdown.
 *
 * Data source: the existing `FileNode` tree from `useNotes()` — flattened to
 * the leaves. Per-note metadata (tags, words, updated) is not yet exposed by
 * the data layer; we derive `title` from the basename and show wordcount /
 * updated as `—` when unknown. When richer metadata is added to NoteData this
 * view will pick it up via `noteMeta` prop.
 */
import { useMemo, useState, useCallback, type CSSProperties } from 'react';
import { Icons } from '../Icons';
import { usePrefs } from '../../stores/prefsStore';
import type { FileNode } from '../../lib/api';

export interface AllNotesViewProps {
  tree: FileNode[];
  starredPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggleStar?: (path: string) => void;
  /** Optional per-path metadata bag; safe to omit. */
  noteMeta?: Map<string, { title?: string; tags?: string[]; words?: number; updated?: string }>;
}

interface FlatNote {
  path: string;
  title: string;
  parent: string;
  tags: string[];
  words: number | null;
  updated: number | null;
  starred: boolean;
}

type ViewMode = 'list' | 'grid';
type SortKey = 'updated' | 'title';

function flattenTree(
  tree: FileNode[],
  starredPaths: Set<string>,
  meta?: AllNotesViewProps['noteMeta'],
): FlatNote[] {
  const out: FlatNote[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file') {
        const m = meta?.get(n.path);
        const basename = n.name.replace(/\.md$/i, '');
        const parent = n.path.includes('/')
          ? n.path.slice(0, n.path.lastIndexOf('/'))
          : '';
        out.push({
          path: n.path,
          title: m?.title ?? basename,
          parent,
          tags: m?.tags ?? [],
          words: m?.words ?? null,
          updated: m?.updated ? new Date(m.updated).getTime() : null,
          starred: starredPaths.has(n.path),
        });
      } else if (n.children) {
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}

function formatDate(ts: number | null): string {
  if (ts === null || ts === undefined) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 38,
  padding: '0 14px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--bg-1)',
  flexShrink: 0,
};

const segmentedWrap: CSSProperties = {
  display: 'flex',
  gap: 1,
  padding: 2,
  background: 'var(--bg-1)',
  border: '1px solid var(--line)',
  borderRadius: 6,
};

function segmentBtn(active: boolean): CSSProperties {
  return {
    padding: '3px 9px',
    borderRadius: 4,
    fontSize: 11.5,
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: active ? 'var(--accent)' : 'var(--fg-2)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
  };
}

const bottomRail: CSSProperties = {
  height: 28,
  padding: '0 14px',
  borderTop: '1px solid var(--line)',
  background: 'var(--bg-1)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--fg-3)',
  flexShrink: 0,
};

export function AllNotesView({
  tree,
  starredPaths,
  onSelect,
  onToggleStar,
  noteMeta,
}: AllNotesViewProps) {
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortKey>('updated');
  const density = usePrefs((s) => s.density);

  const rowHeight = density === 'compact' ? 24 : density === 'cozy' ? 28 : 32;

  const notes = useMemo(
    () => flattenTree(tree, starredPaths, noteMeta),
    [tree, starredPaths, noteMeta],
  );

  const sorted = useMemo(() => {
    const list = [...notes];
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else
      list.sort((a, b) => {
        if ((a.updated === null || a.updated === undefined) && (b.updated === null || b.updated === undefined)) return a.title.localeCompare(b.title);
        if (a.updated === null || a.updated === undefined) return 1;
        if (b.updated === null || b.updated === undefined) return -1;
        return b.updated - a.updated;
      });
    return list;
  }, [notes, sort]);

  const handleStarClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      e.preventDefault();
      onToggleStar?.(path);
    },
    [onToggleStar],
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div style={headerStyle}>
        <Icons.Inbox size={16} style={{ color: 'var(--fg-3)' }} />
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: 'var(--fg)',
          }}
        >
          all notes
        </span>
        <span
          className="mono"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--fg-3)',
            background: 'var(--bg-2)',
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          {notes.length}
        </span>
        <div style={{ flex: 1 }} />
        <div style={segmentedWrap}>
          {(['list', 'grid'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={segmentBtn(view === v)}
              aria-pressed={view === v}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            color: 'var(--fg-1)',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
          aria-label="Sort notes"
        >
          <option value="updated">sort: updated</option>
          <option value="title">sort: title</option>
        </select>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: view === 'grid' ? 16 : 0,
        }}
      >
        {sorted.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            no notes yet
          </div>
        ) : view === 'list' ? (
          <div role="list">
            {sorted.map((n) => (
              <button
                key={n.path}
                type="button"
                role="listitem"
                onClick={() => onSelect(n.path)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto auto auto',
                  gap: 12,
                  alignItems: 'center',
                  width: '100%',
                  minHeight: rowHeight,
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--line)',
                  textAlign: 'left',
                  color: 'var(--fg-1)',
                  background: 'transparent',
                  border: 'none',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  onClick={(e) => onToggleStar && handleStarClick(e, n.path)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: onToggleStar ? 'pointer' : 'default',
                  }}
                  aria-label={n.starred ? 'Unstar' : 'Star'}
                >
                  {n.starred ? (
                    <Icons.StarOn size={13} style={{ color: 'var(--accent-warn)' }} />
                  ) : (
                    <Icons.FileText size={13} style={{ color: 'var(--fg-3)' }} />
                  )}
                </span>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {n.title}
                  </div>
                  {n.parent && (
                    <div
                      className="mono"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--fg-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {n.parent}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {n.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="mono"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        color: 'var(--fg-3)',
                        padding: '1px 5px',
                        border: '1px solid var(--line)',
                        borderRadius: 3,
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                <div
                  className="mono"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--fg-3)',
                    minWidth: 60,
                    textAlign: 'right',
                  }}
                >
                  {n.words !== null && n.words !== undefined ? `${n.words}w` : '—'}
                </div>
                <div
                  className="mono"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--fg-3)',
                    minWidth: 110,
                    textAlign: 'right',
                  }}
                >
                  {formatDate(n.updated)}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {sorted.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => onSelect(n.path)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 8,
                  background: 'var(--bg-1)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 130,
                  color: 'var(--fg-1)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {n.starred ? (
                    <Icons.StarOn size={11} style={{ color: 'var(--accent-warn)' }} />
                  ) : (
                    <Icons.FileText size={11} style={{ color: 'var(--fg-3)' }} />
                  )}
                  <span
                    className="mono"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--fg-3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {n.parent || '/'}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'var(--fg)',
                    lineHeight: 1.3,
                  }}
                >
                  {n.title}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>
                  {n.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="mono"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--accent)',
                        padding: '1px 5px',
                        background: 'var(--accent-soft)',
                        borderRadius: 3,
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                <div
                  className="mono"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--fg-3)',
                  }}
                >
                  {n.words !== null && n.words !== undefined ? `${n.words}w · ` : ''}
                  updated {formatDate(n.updated)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={bottomRail}>
        <span>
          {sorted.length} {sorted.length === 1 ? 'note' : 'notes'}
        </span>
        <span style={{ color: 'var(--fg-4)' }}>·</span>
        <span>view: {view}</span>
        <span style={{ color: 'var(--fg-4)' }}>·</span>
        <span>sort: {sort}</span>
      </div>
    </div>
  );
}
