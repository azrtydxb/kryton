import { MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { FileNode } from '../../lib/api';
import { Editor, EditorCursorState } from '../Editor/Editor';
import { EditorToolbar } from '../Editor/EditorToolbar';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { BookOpen, Star, FileDown } from 'lucide-react';

interface EditModeViewProps {
  activeNote: { path: string; title: string; content: string };
  editContent: string | null;
  originalContent: string | null;
  vimEnabled: boolean;
  isStarred: boolean;
  resolvedTheme: string;
  allNotes: FileNode[];
  editorViewRef: MutableRefObject<EditorView | undefined>;
  previewRef: MutableRefObject<HTMLDivElement | null>;
  onSave: () => void;
  onCancel: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onVimToggle: (enabled: boolean) => void;
  onContentChange: (content: string) => void;
  onCursorStateChange: (state: EditorCursorState) => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function EditModeView({
  activeNote, editContent, originalContent,
  vimEnabled, isStarred, resolvedTheme, allNotes,
  editorViewRef, previewRef,
  onSave, onCancel, onToggleStar, onPdfExport,
  onVimToggle, onContentChange, onCursorStateChange,
  onNoteSelect, onLinkClick, onCreateNote,
}: EditModeViewProps) {
  const hasChanges = editContent !== originalContent;

  return (
    <>
      <div className="w-1/2 flex flex-col overflow-hidden border-r">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
            {activeNote.path}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors"
              title="Save changes"
            >
              Save
            </button>
            <button
              onClick={onCancel}
              className="px-2 py-0.5 rounded text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
              title="Cancel editing (discard changes)"
            >
              Cancel
            </button>
            <button
              onClick={onToggleStar}
              className={`p-1 rounded transition-colors ${isStarred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'}`}
              title={isStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
            >
              <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={onPdfExport}
              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Export as PDF"
            >
              <FileDown size={14} />
            </button>
            {hasChanges && <span className="text-xs text-yellow-500">Unsaved</span>}
            {!hasChanges && <span className="text-xs text-gray-500">No changes</span>}
          </div>
        </div>
        <EditorToolbar viewRef={editorViewRef} vimEnabled={vimEnabled} onVimToggle={onVimToggle} />
        <div className="flex-1 overflow-hidden">
          <Editor
            content={editContent ?? activeNote.content}
            onChange={onContentChange}
            darkMode={resolvedTheme === 'dark'}
            allNotes={allNotes}
            onCursorStateChange={onCursorStateChange}
            viewRef={editorViewRef}
            vimEnabled={vimEnabled}
          />
        </div>
        <OutgoingLinksPanel
          content={activeNote.content}
          allNotes={allNotes}
          onNoteSelect={onNoteSelect}
          onCreateNote={onCreateNote}
        />
        <BacklinksPanel notePath={activeNote.path} onNoteSelect={onNoteSelect} />
      </div>
      <div className="w-1/2 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b bg-gray-50/50 dark:bg-surface-900/50" style={{ minHeight: '39px' }}>
          <div className="flex items-center">
            <BookOpen size={14} className="text-gray-400 mr-2" />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Preview</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" ref={previewRef}>
          <Preview
            content={activeNote.content}
            onLinkClick={onLinkClick}
            allNotes={allNotes}
            onCreateNote={onCreateNote}
          />
        </div>
      </div>
    </>
  );
}
