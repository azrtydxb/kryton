/**
 * TagsView — full-pane browser of every tag in the vault.
 *
 * Mirrors AllNotesView: a 38px header strip with a count, a left-aligned
 * tag chip grid, and a side detail showing the notes for the selected
 * tag. Replaces the editor pane (sidebar + graph rail stay mounted).
 */
import { useState, useCallback, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type TagData, type TagNoteData } from '../../lib/api';
import { Icons } from '../Icons';

interface TagsViewProps {
  onNoteSelect: (path: string) => void;
  /**
   * Tag to pre-select when the view mounts. Used when the user navigates
   * here by clicking a tag chip in the sidebar. Subsequent clicks inside
   * the view manage selection internally.
   */
  initialTag?: string | null;
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 38,
  padding: '0 14px',
  borderBottom: '1px solid var(--line)',
  flexShrink: 0,
};

/** Per prototype/app/sidebar.jsx kr-tag styling. */
const tagChip = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 7px 3px 6px',
  borderRadius: 4,
  background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
  color: active ? 'var(--accent)' : 'var(--fg-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  cursor: 'pointer',
  transition: 'background 120ms, border-color 120ms, color 120ms',
});

export function TagsView({ onNoteSelect, initialTag }: TagsViewProps) {
  // initialTag seeds the first render. The parent passes `key={initialTag}`
  // so picking a different tag from the sidebar remounts the view and
  // re-seeds state without any sync-in-effect dance.
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null);

  // The tags index and the per-tag note list both come from the network —
  // delegated to react-query so loading/data state lives outside React's
  // effect machinery (no sync setState in effects).
  const { data: tags = [] } = useQuery<TagData[]>({
    queryKey: ['tags'],
    queryFn: () => api.getTags(),
    staleTime: 30_000,
  });
  const { data: tagNotes = [], isLoading: loadingNotes } = useQuery<TagNoteData[]>({
    queryKey: ['tag-notes', selectedTag],
    queryFn: () => api.getNotesByTag(selectedTag as string),
    enabled: !!selectedTag,
    staleTime: 30_000,
  });

  const handleTagSelect = useCallback((tag: string) => {
    setSelectedTag((prev) => (prev === tag ? null : tag));
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        background: 'var(--bg)',
        height: '100%',
      }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <Icons.Hash size={14} style={{ color: 'var(--accent)' }} />
        <span
          className="mono"
          style={{
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--fg-2)',
          }}
        >
          tags
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--fg-4)' }}
        >
          {tags.length}
        </span>
        <div style={{ flex: 1 }} />
        {selectedTag && (
          <button
            onClick={() => setSelectedTag(null)}
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--fg-3)',
              padding: '4px 8px',
              borderRadius: 4,
              background: 'transparent',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            clear filter
          </button>
        )}
      </div>

      {/* Body — chip grid + selected-tag notes */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Chip grid */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            padding: '16px 18px',
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            gap: 6,
            borderRight: selectedTag ? '1px solid var(--line)' : 'none',
          }}
        >
          {tags.length === 0 && (
            <div
              className="mono"
              style={{ color: 'var(--fg-4)', fontSize: 12, padding: '4px 0' }}
            >
              no tags yet — tag a note with #&lt;name&gt;
            </div>
          )}
          {tags.map(({ tag, count }) => {
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => handleTagSelect(tag)}
                style={tagChip(active)}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--line)';
                    e.currentTarget.style.color = 'var(--fg-1)';
                  }
                }}
              >
                <span style={{ color: active ? 'var(--accent)' : 'var(--fg-3)' }}>#</span>
                {tag}
                <span style={{ color: 'var(--fg-4)', marginLeft: 2 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Selected-tag notes column */}
        {selectedTag && (
          <div
            style={{
              width: 360,
              minWidth: 240,
              flexShrink: 0,
              overflow: 'auto',
              padding: '18px 18px 32px',
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-3)',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icons.Hash size={11} />
              {selectedTag}
              <span style={{ color: 'var(--fg-4)' }}>· {tagNotes.length}</span>
            </div>

            {loadingNotes && (
              <div
                className="mono"
                style={{ fontSize: 12, color: 'var(--fg-4)', padding: '6px 8px' }}
              >
                loading…
              </div>
            )}

            {!loadingNotes && tagNotes.length === 0 && (
              <div
                className="mono"
                style={{ fontSize: 12, color: 'var(--fg-4)', padding: '6px 8px' }}
              >
                no notes with this tag
              </div>
            )}

            {!loadingNotes &&
              tagNotes.map(({ notePath, title }) => (
                <button
                  key={notePath}
                  onClick={() => onNoteSelect(notePath)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 5,
                    background: 'transparent',
                    textAlign: 'left',
                    fontSize: 13,
                    color: 'var(--fg-1)',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icons.FileText size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--fg-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}
                  >
                    {notePath}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
