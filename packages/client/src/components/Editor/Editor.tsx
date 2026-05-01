import type { MutableRefObject } from 'react';
import { NoteEditorReact, type EditorCursorState } from '@azrtydxb/ui';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { FileNode } from '../../lib/api';
import { collectNotePaths } from '../../lib/noteTreeUtils';

export type { EditorCursorState };

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  darkMode: boolean;
  allNotes: FileNode[];
  onCursorStateChange?: (state: EditorCursorState) => void;
  viewRef?: MutableRefObject<EditorView | undefined>;
  pluginExtensions?: Extension[];
}

/**
 * Thin adapter over @azrtydxb/ui NoteEditorReact.
 * Converts client's `allNotes: FileNode[]` to flat `notePaths` for
 * the ui component's [[wiki-link]] autocomplete.
 */
export function Editor({
  content,
  onChange,
  darkMode,
  allNotes,
  onCursorStateChange,
  viewRef,
  pluginExtensions,
}: EditorProps) {
  const notePaths = collectNotePaths(allNotes);

  return (
    <NoteEditorReact
      content={content}
      onChange={onChange}
      darkMode={darkMode}
      notePaths={notePaths}
      onCursorStateChange={onCursorStateChange}
      viewRef={viewRef}
      pluginExtensions={pluginExtensions}
    />
  );
}
