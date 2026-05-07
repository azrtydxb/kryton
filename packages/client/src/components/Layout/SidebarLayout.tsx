import { FileNode } from '../../lib/api';
import { Sidebar } from '../Sidebar/Sidebar';
import { Icons } from '../Icons';

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
  children?: React.ReactNode;
}

export function SidebarLayout({
  sidebarOpen, setSidebarOpen,
  mobileMenuOpen, setMobileMenuOpen,
  sidebarWidth,
  tree, activeNotePath, starredPaths, sharedNotes,
  onSelect, onCreateNote, onDeleteNote, onRenameNote,
  onCreateFolder, onDeleteFolder, onRenameFolder,
  onDailyNote, onCreateFromTemplate, onToggleStar, onShare,
  children,
}: SidebarLayoutProps) {
  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'oklch(0 0 0 / 0.5)' }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Collapsed bar (desktop only) — shown when the full sidebar is closed */}
      <div
        className={`hidden ${sidebarOpen ? 'md:hidden' : 'md:flex'} flex-col items-center flex-shrink-0`}
        style={{
          width: 36,
          background: 'var(--bg-1)',
          borderRight: '1px solid var(--line)',
          padding: '6px 0',
        }}
      >
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
          title="Open sidebar (Ctrl+B)"
          style={{
            width: 28, height: 28, borderRadius: 5,
            color: 'var(--fg-3)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
        >
          <Icons.PanelLeft size={14} />
        </button>
      </div>

      {/* Full sidebar */}
      <aside
        className={`
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          ${sidebarOpen ? '' : 'md:!w-0 md:overflow-hidden md:border-r-0'}
          fixed md:relative inset-y-0 left-0 z-40 md:z-0
          flex-shrink-0
        `}
        style={{
          width: sidebarOpen ? `${sidebarWidth}px` : undefined,
          background: 'var(--bg-1)',
          borderRight: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
            onCollapse={() => setSidebarOpen(false)}
            beforeFooter={children}
          />
        </div>
      </aside>

      {/* Sidebar resize handle removed per design — sidebar uses a fixed
         260px width and is toggled via the brand-row collapse button. */}
    </>
  );
}
