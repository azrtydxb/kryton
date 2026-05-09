import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { NotePreviewReact } from '@azrtydxb/ui';
import { api, BacklinkData, FileNode } from '../../lib/api';
import { collectNoteNames } from '../../lib/noteTreeUtils';
import { DataviewBlock } from './DataviewBlock';
import { Icons } from '../Icons';

interface PreviewProps {
  content: string;
  onLinkClick: (noteName: string) => void;
  allNotes?: FileNode[];
  onCreateNote?: (name: string) => void;
  notePath?: string;
  /** ISO timestamp of the note's last modification — surfaced in the meta header. */
  modifiedAt?: string;
  /** Open a backlink note. When provided, the inline backlinks tail is clickable. */
  onNoteSelect?: (path: string) => void;
  getCodeFenceRenderer?: (language: string) => { component: React.ComponentType<{ content: string; notePath: string }> } | undefined;
  /** Current embed depth — kept for API compat; NotePreviewReact manages depth internally */
  embedDepth?: number;
  /** Set of note paths in the current embed chain — kept for API compat */
  embedChain?: Set<string>;
}

/**
 * Token-based markdown styles (per design handoff §"Markdown rendering").
 * Scoped to the `.kryton-md` wrapper around `NotePreviewReact` so we override
 * the legacy Tailwind rules in globals.css `.markdown-preview` without
 * touching shared CSS.
 */
const MD_CSS = `
.kryton-md .markdown-preview {
  font-family: var(--font-sans);
  /* prototype/app/editor.jsx PreviewBody: fontSize 15, lineHeight 1.7 */
  font-size: 15px;
  line-height: 1.7;
  color: var(--fg-1);
  /* Top padding handled by the meta-header row above; bottom keeps the
     "scroll past content" feel from the prototype. */
  padding: 8px 48px 80px;
  max-width: 760px;
  margin: 0 auto;
}
.kryton-md .markdown-preview h1 {
  font-family: var(--font-display);
  /* prototype: fontSize 32, letterSpacing -0.4 */
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.4px;
  color: var(--fg);
  margin: 4px 0 18px;
  border: 0;
  padding: 0;
}
.kryton-md .markdown-preview h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--fg);
  margin: 28px 0 10px;
  border: 0;
  padding: 0;
}
.kryton-md .markdown-preview h3 {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
  margin: 22px 0 8px;
}
.kryton-md .markdown-preview h4,
.kryton-md .markdown-preview h5,
.kryton-md .markdown-preview h6 {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--fg);
  margin: 18px 0 6px;
}
.kryton-md .markdown-preview p { margin: 0 0 14px; color: var(--fg-1); }
.kryton-md .markdown-preview strong { color: var(--fg); font-weight: 600; }
.kryton-md .markdown-preview em { color: var(--fg-1); }

.kryton-md .markdown-preview a,
.kryton-md .markdown-preview .wiki-link {
  color: var(--link);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 3px;
  cursor: pointer;
}
.kryton-md .markdown-preview a:hover,
.kryton-md .markdown-preview .wiki-link:hover {
  color: var(--accent);
}
.kryton-md .markdown-preview .wiki-link-broken {
  color: var(--accent-danger);
  text-decoration: underline wavy;
  text-underline-offset: 3px;
}

.kryton-md .markdown-preview code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 1px 6px;
  border-radius: 4px;
}
.kryton-md .markdown-preview pre {
  position: relative;
  font-family: var(--font-mono);
  background: var(--bg-2);
  color: var(--fg-1);
  padding: 12px;
  border-radius: 6px;
  margin: 0 0 16px;
  overflow-x: auto;
  border: 1px solid var(--line);
}
.kryton-md .markdown-preview pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  border-radius: 0;
  font-size: 12.5px;
}
.kryton-md .markdown-preview pre[data-language]::before {
  content: attr(data-language);
  position: absolute;
  top: 6px;
  right: 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
  pointer-events: none;
}

.kryton-md .markdown-preview blockquote {
  border-left: 2px solid var(--accent);
  padding: 0 0 0 14px;
  margin: 14px 0;
  color: var(--fg-2);
  font-style: italic;
}

.kryton-md .markdown-preview ul,
.kryton-md .markdown-preview ol {
  padding-left: 22px;
  margin: 8px 0 14px;
}
.kryton-md .markdown-preview li { margin-bottom: 4px; }

.kryton-md .markdown-preview hr {
  border: 0;
  border-top: 1px dashed var(--line);
  margin: 24px 0;
}

.kryton-md .markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}
.kryton-md .markdown-preview th,
.kryton-md .markdown-preview td {
  border: 1px solid var(--line);
  padding: 6px 10px;
  text-align: left;
}
.kryton-md .markdown-preview th {
  background: var(--bg-1);
  color: var(--fg);
  font-weight: 600;
}

.kryton-md .markdown-preview img { max-width: 100%; border-radius: 6px; }
`;

/**
 * Thin adapter over @azrtydxb/ui NotePreviewReact.
 *
 * Responsibilities retained in the client:
 * - Converting allNotes FileNode[] to the flat existingNotes Set<string>
 * - Providing onFetchNoteContent via api.getNote (HTTP)
 * - Extracting dataview blocks and rendering them with DataviewBlock
 *   (DataviewBlock requires HTTP calls; it cannot live in the ui package)
 * - Applying token-based markdown styles via the `.kryton-md` wrapper.
 */
export function Preview({
  content,
  onLinkClick,
  allNotes,
  onCreateNote,
  notePath = '',
  modifiedAt,
  onNoteSelect,
  getCodeFenceRenderer,
}: PreviewProps) {
  const existingNotes = useMemo(() => {
    if (!allNotes) return new Set<string>();
    return collectNoteNames(allNotes);
  }, [allNotes]);

  const [backlinks, setBacklinks] = useState<BacklinkData[]>([]);
  useEffect(() => {
    if (!notePath) return;
    let cancelled = false;
    api
      .getBacklinks(notePath)
      .then((b) => { if (!cancelled) setBacklinks(b); })
      .catch(() => { if (!cancelled) setBacklinks([]); });
    return () => { cancelled = true; };
  }, [notePath]);

  const handleFetchNoteContent = useCallback(async (name: string): Promise<string | null> => {
    try {
      const note = await api.getNote(name.endsWith('.md') ? name : `${name}.md`);
      return note.content;
    } catch {
      return null;
    }
  }, []);

  // Extract dataview blocks before passing content to the ui renderer.
  // NotePreviewReact doesn't know about dataview; we keep that client-specific.
  // Default to empty string so a brief activeNote.content === undefined
  // window (e.g. immediately after createNote returns its bare metadata)
  // doesn't crash NotePreviewReact's matchAll() calls.
  const dataviewBlocks: { id: string; query: string }[] = [];
  let processedContent = content ?? '';

  const dataviewRegex = /```dataview\n([\s\S]*?)```/g;
  let dvMatch;
  while ((dvMatch = dataviewRegex.exec(processedContent)) !== null) {
    const id = `dataview-${dataviewBlocks.length}`;
    dataviewBlocks.push({ id, query: dvMatch[1].trim() });
    processedContent = processedContent.replace(
      dvMatch[0],
      `<div data-dataview-id="${id}"></div>`
    );
  }

  return (
    <div className="kryton-md">
      <style>{MD_CSS}</style>
      {/* Meta header per prototype/app/editor.jsx PreviewBody:
          file-icon · path · words · updated <date>. Sits above the h1 in
          mono 11.5px / --fg-3, matching the design tokens. */}
      {notePath && (
        <div
          className="mono"
          style={{
            maxWidth: 760,
            margin: '0 auto',
            padding: '28px 48px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--fg-3)',
          }}
        >
          <Icons.FileText size={11} aria-hidden />
          <span>/{notePath}</span>
          {(() => {
            const words = (content.replace(/`{1,3}.*?`{1,3}/gs, '').match(/\S+/g) || []).length;
            return (
              <>
                <span aria-hidden>·</span>
                <span>{words} words</span>
              </>
            );
          })()}
          {modifiedAt && (
            <>
              <span style={{ flex: 1 }} aria-hidden />
              <span>
                updated{' '}
                {new Date(modifiedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </>
          )}
        </div>
      )}
      <NotePreviewReact
        content={processedContent}
        onLinkClick={onLinkClick}
        existingNotes={existingNotes}
        onCreateNote={onCreateNote}
        notePath={notePath}
        getCodeFenceRenderer={getCodeFenceRenderer}
        onFetchNoteContent={handleFetchNoteContent}
      />
      {dataviewBlocks.map(block => (
        <DataviewBlock key={block.id} query={block.query} onLinkClick={onLinkClick} />
      ))}

      {notePath && backlinks.length > 0 && (
        <div
          style={{
            maxWidth: 760,
            margin: '0 auto',
            padding: '0 36px 80px',
            marginTop: 28,
          }}
        >
          <div
            style={{
              borderTop: '1px dashed var(--line)',
              paddingTop: 18,
            }}
          >
            <div
              className="mono"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--fg-3)',
                marginBottom: 10,
              }}
            >
              <Icons.Link size={10} />
              Backlinks
              <span style={{ color: 'var(--fg-4)' }}>· {backlinks.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {backlinks.map((b) => (
                <button
                  key={b.path}
                  onClick={() => onNoteSelect?.(b.path)}
                  disabled={!onNoteSelect}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--bg-1)',
                    border: '1px solid var(--line)',
                    fontSize: 13,
                    color: 'var(--fg-1)',
                    textAlign: 'left',
                    cursor: onNoteSelect ? 'pointer' : 'default',
                    transition: 'background 120ms, border-color 120ms',
                  }}
                  onMouseEnter={(e) => {
                    if (onNoteSelect) {
                      e.currentTarget.style.background = 'var(--bg-2)';
                      e.currentTarget.style.borderColor = 'var(--line-strong)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (onNoteSelect) {
                      e.currentTarget.style.background = 'var(--bg-1)';
                      e.currentTarget.style.borderColor = 'var(--line)';
                    }
                  }}
                >
                  <Icons.FileText size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.title}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--fg-4)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 280,
                    }}
                  >
                    {b.path}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
