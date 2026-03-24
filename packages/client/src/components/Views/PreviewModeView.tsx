import { MutableRefObject } from 'react';
import { FileNode } from '../../lib/api';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { BookOpen, Pencil, Share2, Star, FileDown } from 'lucide-react';

interface PreviewModeViewProps {
  activeNote: { path: string; title: string; content: string };
  isStarred: boolean;
  allNotes: FileNode[];
  previewRef: MutableRefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onShare: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function PreviewModeView({
  activeNote, isStarred, allNotes, previewRef,
  onEdit, onShare, onToggleStar, onPdfExport,
  onNoteSelect, onLinkClick, onCreateNote,
}: PreviewModeViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
        <div className="flex items-center">
          <BookOpen size={14} className="text-gray-400 mr-2" />
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
            {activeNote.path}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors" title="Edit note (Ctrl+E)">
            <Pencil size={14} />
          </button>
          <button onClick={onShare} className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors" title="Share note">
            <Share2 size={14} />
          </button>
          <button
            onClick={onToggleStar}
            className={`p-1 rounded transition-colors ${isStarred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'}`}
            title={isStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
          >
            <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onPdfExport} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Export as PDF">
            <FileDown size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" ref={previewRef}>
        <Preview content={activeNote.content} onLinkClick={onLinkClick} allNotes={allNotes} onCreateNote={onCreateNote} />
      </div>
      <OutgoingLinksPanel content={activeNote.content} allNotes={allNotes} onNoteSelect={onNoteSelect} onCreateNote={onCreateNote} />
      <BacklinksPanel notePath={activeNote.path} onNoteSelect={onNoteSelect} />
    </div>
  );
}
