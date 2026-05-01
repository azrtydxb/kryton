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
 * Thin adapter over @azrtydxb/ui NotePreviewReact.
 *
 * Responsibilities retained in the client:
 * - Converting allNotes FileNode[] to the flat existingNotes Set<string>
 * - Providing onFetchNoteContent via api.getNote (HTTP)
 * - Extracting dataview blocks and rendering them with DataviewBlock
 *   (DataviewBlock requires HTTP calls; it cannot live in the ui package)
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
    <>
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
    </>
  );
}
