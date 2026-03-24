import { FileNode } from '../../lib/api';
import { Sidebar } from '../Sidebar/Sidebar';
import { ResizeHandle } from './ResizeHandle';
import { PanelLeft } from 'lucide-react';

interface SharedNote {
  id: string;
  ownerUserId: string;
  ownerName: string;
  path: string;
  isFolder: boolean;
  permission: string;
}

interface SidebarLayoutProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  sidebarWidth: number;
  onSidebarResize: (delta: number) => void;
  tree: FileNode[];
  activeNotePath: string | null;
  starredPaths: Set<string>;
  sharedNotes: SharedNote[];
  onSelect: (path: string) => void;
  onCreateNote: (name: string, content?: string) => Promise<unknown>;
  onDeleteNote: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void>;
  onDailyNote: () => void;
  onCreateFromTemplate: () => void;
  onToggleStar: (path: string) => void;
  onShare: (path: string, isFolder: boolean) => void;
}

export function SidebarLayout({
  sidebarOpen, setSidebarOpen,
  mobileMenuOpen, setMobileMenuOpen,
  sidebarWidth, onSidebarResize,
  tree, activeNotePath, starredPaths, sharedNotes,
  onSelect, onCreateNote, onDeleteNote, onRenameNote,
  onCreateFolder, onDeleteFolder, onRenameFolder,
  onDailyNote, onCreateFromTemplate, onToggleStar, onShare,
}: SidebarLayoutProps) {
  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Collapsed bar (desktop only) */}
      <div className={`hidden ${sidebarOpen ? 'md:hidden' : 'md:flex'} flex-col items-center w-10 flex-shrink-0 border-r bg-gray-50 dark:bg-surface-900 py-2`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="btn-ghost p-2"
          aria-label="Open sidebar"
          title="Open sidebar (Ctrl+B)"
        >
          <PanelLeft size={18} />
        </button>
      </div>

      {/* Full sidebar */}
      <aside
        className={`
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          ${sidebarOpen ? '' : 'md:!w-0 md:overflow-hidden md:border-r-0'}
          fixed md:relative inset-y-0 left-0 z-40 md:z-0
          w-72 flex-shrink-0
          bg-gray-50 dark:bg-surface-900 border-r
        `}
        style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
      >
        <div className="hidden md:flex items-center px-2 py-1.5 border-b">
          <button
            onClick={() => setSidebarOpen(false)}
            className="btn-ghost p-1.5"
            aria-label="Close sidebar"
            title="Close sidebar (Ctrl+B)"
          >
            <PanelLeft size={16} />
          </button>
        </div>
        <Sidebar
          tree={tree}
          activeNotePath={activeNotePath}
          onSelect={onSelect}
          onCreateNote={onCreateNote}
          onDeleteNote={onDeleteNote}
          onRenameNote={onRenameNote}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onDailyNote={onDailyNote}
          onCreateFromTemplate={onCreateFromTemplate}
          starredPaths={starredPaths}
          onToggleStar={onToggleStar}
          sharedNotes={sharedNotes}
          onShare={onShare}
        />
      </aside>

      {/* Sidebar resize handle */}
      {sidebarOpen && <ResizeHandle direction="horizontal" onResize={onSidebarResize} />}
    </>
  );
}
