import { FileNode } from '../../lib/api';
import { Sidebar } from '../Sidebar/Sidebar';
import { Icons } from '../Icons';
import { formatShortcut } from '../../lib/platform';

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
  /** Sidebar tag-chip click — routes to the tags view filtered by `tag`. */
  onTagSelect?: (tag: string) => void;
  children?: React.ReactNode;
}

export function SidebarLayout({
  sidebarOpen, setSidebarOpen,
  mobileMenuOpen, setMobileMenuOpen,
  tree, activeNotePath, starredPaths, sharedNotes,
  onSelect, onCreateNote, onDeleteNote, onRenameNote,
  onCreateFolder, onDeleteFolder, onRenameFolder,
  onDailyNote, onCreateFromTemplate, onToggleStar, onShare,
  onTagSelect,
  children,
}: SidebarLayoutProps) {
  // Desktop closed state: a narrow 36px rail with just the expand button so
  // the user can re-open the sidebar (the bible's prototype omits this
  // because it has no toggle; we keep it to stay reachable).
  if (!sidebarOpen && !mobileMenuOpen) {
    return (
      <aside
        className="hidden md:flex flex-shrink-0"
        style={{
          width: 36,
          background: 'var(--bg-1)',
          borderRight: '1px solid var(--line)',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 10,
        }}
      >
        <button
          type="button"
          aria-label="Expand sidebar"
          title={`Expand sidebar (${formatShortcut(['mod', 'B'])})`}
          onClick={() => setSidebarOpen(true)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 5,
            background: 'transparent',
            border: '1px solid transparent',
            color: 'var(--fg-3)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'color 120ms, background 120ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--fg)';
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--fg-3)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Icons.PanelLeft size={14} />
        </button>
      </aside>
    );
  }

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

      {/* Full sidebar — fixed 260px width per design */}
      <aside
        className={`
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          fixed md:relative inset-y-0 left-0 z-40 md:z-0
          flex-shrink-0
        `}
        style={{
          width: '260px',
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
            onTagSelect={onTagSelect}
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
