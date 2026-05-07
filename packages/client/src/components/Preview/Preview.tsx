import React, { useMemo, useCallback } from 'react';
import { NotePreviewReact } from '@azrtydxb/ui';
import { api, FileNode } from '../../lib/api';
import { collectNoteNames } from '../../lib/noteTreeUtils';
import { DataviewBlock } from './DataviewBlock';

interface PreviewProps {
  content: string;
  onLinkClick: (noteName: string) => void;
  allNotes?: FileNode[];
  onCreateNote?: (name: string) => void;
  notePath?: string;
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
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--fg-1);
  padding: 28px 36px 80px;
  max-width: 760px;
  margin: 0 auto;
}
.kryton-md .markdown-preview h1 {
  font-family: var(--font-display);
  font-size: 28px;
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
  getCodeFenceRenderer,
}: PreviewProps) {
  const existingNotes = useMemo(() => {
    if (!allNotes) return new Set<string>();
    return collectNoteNames(allNotes);
  }, [allNotes]);

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
  const dataviewBlocks: { id: string; query: string }[] = [];
  let processedContent = content;

  const dataviewRegex = /```dataview\n([\s\S]*?)```/g;
  let dvMatch;
  while ((dvMatch = dataviewRegex.exec(content)) !== null) {
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
    </div>
  );
}
