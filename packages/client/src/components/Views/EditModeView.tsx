import { MutableRefObject, ComponentType, useState, useEffect, useRef } from 'react';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useDebouncedCallback } from 'use-debounce';
import { FileNode } from '../../lib/api';
import { Editor, EditorCursorState } from '../Editor/Editor';
import { EditorToolbar } from '../Editor/EditorToolbar';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { Breadcrumbs } from '../Layout/Breadcrumbs';
import { BookOpen, Star, FileDown } from 'lucide-react';

type SaveStatus = 'unchanged' | 'unsaved' | 'saving' | 'saved' | 'error';

interface EditModeViewProps {
  activeNote: { path: string; title: string; content: string };
  editContent: string | null;
  originalContent: string | null;
  isStarred: boolean;
  resolvedTheme: string;
  allNotes: FileNode[];
  editorViewRef: MutableRefObject<EditorView | undefined>;
  previewRef: MutableRefObject<HTMLDivElement | null>;
  pluginExtensions?: Extension[];
  getCodeFenceRenderer?: (language: string) => { component: ComponentType<{ content: string; notePath: string }> } | undefined;
  onSave: () => void;
  onAutoSave: () => Promise<void>;
  onCancel: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onContentChange: (content: string) => void;
  onCursorStateChange: (state: EditorCursorState) => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function EditModeView({
  activeNote, editContent, originalContent,
  isStarred, resolvedTheme, allNotes,
  editorViewRef, previewRef, pluginExtensions,
  getCodeFenceRenderer,
  onSave, onAutoSave, onCancel, onToggleStar, onPdfExport,
  onContentChange, onCursorStateChange,
  onNoteSelect, onLinkClick, onCreateNote,
}: EditModeViewProps) {
  const hasChanges = editContent !== originalContent;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('unchanged');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedAutoSave = useDebouncedCallback(async () => {
    setSaveStatus('saving');
    try {
      await onAutoSave();
      setSaveStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('unchanged');
      }, 2000);
    } catch {
      setSaveStatus('error');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('unsaved');
      }, 3000);
    }
  }, 2000);

  useEffect(() => {
    if (hasChanges) {
      setSaveStatus('unsaved');
      debouncedAutoSave();
    } else if (saveStatus === 'unsaved') {
      setSaveStatus('unchanged');
      debouncedAutoSave.cancel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, originalContent]);

  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderSaveStatus() {
    switch (saveStatus) {
      case 'saving':
        return <span className="text-xs text-gray-400 italic">Saving...</span>;
      case 'saved':
        return <span className="text-xs text-green-500">Saved</span>;
      case 'error':
        return <span className="text-xs text-red-500">Save failed</span>;
      case 'unsaved':
        return <span className="text-xs text-yellow-500">Unsaved changes</span>;
      default:
        return <span className="text-xs text-gray-500">No changes</span>;
    }
  }

  return (
    <>
      <div className="w-full md:w-1/2 flex flex-col overflow-hidden md:border-r">
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
            {renderSaveStatus()}
          </div>
        </div>
        <EditorToolbar viewRef={editorViewRef} />
        <div className="flex-1 overflow-hidden">
          <Editor
            content={editContent ?? activeNote.content}
            onChange={onContentChange}
            darkMode={resolvedTheme === 'dark'}
            allNotes={allNotes}
            onCursorStateChange={onCursorStateChange}
            viewRef={editorViewRef}
            pluginExtensions={pluginExtensions}
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
      <div className="hidden md:flex md:w-1/2 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b bg-gray-50/50 dark:bg-surface-900/50" style={{ minHeight: '39px' }}>
          <div className="flex items-center">
            <BookOpen size={14} className="text-gray-400 mr-2" />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Preview</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" ref={previewRef}>
          <Preview
            content={editContent ?? activeNote.content}
            onLinkClick={onLinkClick}
            allNotes={allNotes}
            onCreateNote={onCreateNote}
            notePath={activeNote.path}
            getCodeFenceRenderer={getCodeFenceRenderer}
          />
        </div>
      </div>
    </>
  );
}
