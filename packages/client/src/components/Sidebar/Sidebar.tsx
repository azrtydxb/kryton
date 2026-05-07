import { useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { FileNode, TrashItem, api } from '../../lib/api';
import { FileTree, FavoritesSection, TrashList, Resizer } from '@azrtydxb/ui';
import type { TrashItem as UiTrashItem } from '@azrtydxb/ui';
import { TagPane } from '../Tags/TagPane';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import { Icons } from '../Icons';

interface SharedNote {
  id: string;
  ownerUserId: string;
  ownerName: string;
  path: string;
  isFolder: boolean;
  permission: string;
}

interface SidebarProps {
  tree: FileNode[];
  activeNotePath: string | null;
  onSelect: (path: string) => void;
  onCreateNote: (path: string, content?: string) => Promise<unknown>;
  onDeleteNote: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void>;
  onDailyNote: () => void;
  onCreateFromTemplate: () => void;
  starredPaths: Set<string>;
  onToggleStar: (path: string) => void;
  sharedNotes?: SharedNote[];
  onShare?: (path: string, isFolder: boolean) => void;
  /** optional collapse trigger from parent layout */
  onCollapse?: () => void;
  /** optional version string rendered in the brand row */
  version?: string;
  /** optional content rendered between the section list and the agents footer (e.g. plugin slot) */
  beforeFooter?: ReactNode;
}

const DEFAULT_VERSION = 'v4.3.2';

/* helpers ------------------------------------------------------------------ */

function countNotes(nodes: FileNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'file') n += 1;
    if (node.children?.length) n += countNotes(node.children);
  }
  return n;
}

/* sub-components ----------------------------------------------------------- */

function SectionHeader({
  open, setOpen, label, count, actions,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  label: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <div
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 26,
        padding: '0 8px 0 6px',
        color: 'var(--fg-3)',
        fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase',
        fontWeight: 500,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center',
          color: 'inherit', width: 16, height: 16,
        }}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      >
        <Icons.ChevronD
          size={11}
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}
        />
      </button>
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ color: 'var(--fg-4)' }}>{count}</span>
      )}
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

function NavRow({
  icon, label, hint, active, onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', height: 'var(--row, 24px)',
        padding: '0 8px', borderRadius: 6,
        color: active ? 'var(--accent)' : 'var(--fg-1)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        textAlign: 'left',
        fontSize: 'var(--fs-base)',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: active ? 'var(--accent)' : 'var(--fg-3)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint !== undefined && hint !== null && (
        <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 11 }}>{hint}</span>
      )}
    </button>
  );
}

function AgentsFooter() {
  return (
    <div
      className="mono"
      style={{
        height: 28, flexShrink: 0,
        borderTop: '1px solid var(--line)',
        background: 'var(--bg-1)',
        padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: 'var(--fg-2)',
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 6px', borderRadius: 3,
          background: 'var(--accent-soft)', color: 'var(--accent)',
        }}
      >
        <span
          className="pulse"
          style={{
            display: 'inline-block',
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--accent)',
          }}
        />
        MCP
      </span>
      <span style={{ color: 'var(--fg-3)' }}>0 agents online</span>
      <div style={{ flex: 1 }} />
    </div>
  );
}

/* main --------------------------------------------------------------------- */

/**
 * Sidebar — design-system rebuild.
 * Wires existing data hooks (FileTree, FavoritesSection, TagPane, TrashList)
 * to the new chrome (brand row, primary nav, sections, agents footer).
 */
export function Sidebar({
  tree,
  activeNotePath,
  onSelect,
  onCreateNote,
  onDeleteNote,
  onRenameNote,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onDailyNote,
  // onCreateFromTemplate kept on the SidebarProps surface but the
  // primary-nav row was replaced by Graph per design spec.
  starredPaths,
  onToggleStar,
  sharedNotes,
  onShare,
  onCollapse,
  version = DEFAULT_VERSION,
  beforeFooter,
}: SidebarProps) {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoadingKey, setTrashLoadingKey] = useState<string | null>(null);
  const [tagPaneHeight, setTagPaneHeight] = useState(180);
  const [favOpen, setFavOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const addToast = useToastStore(s => s.addToast);

  const noteCount = useMemo(() => countNotes(tree), [tree]);

  const refreshTrash = useCallback(() => {
    api.listTrash().then(setTrashItems).catch(() => setTrashItems([]));
  }, []);

  useEffect(() => { refreshTrash(); }, [refreshTrash]);

  const handleTagResize = useCallback((delta: number) => {
    setTagPaneHeight(h => Math.max(60, Math.min(500, h - delta)));
  }, []);

  const handleTrashRestore = useCallback(async (item: UiTrashItem) => {
    setTrashLoadingKey(`restore:${item.path}`);
    try {
      await api.restoreFromTrash(item.path);
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to restore: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  const handleTrashDelete = useCallback(async (item: UiTrashItem) => {
    setTrashLoadingKey(`delete:${item.path}`);
    try {
      await api.permanentlyDelete(item.path);
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  const handleEmptyTrash = useCallback(async () => {
    setTrashLoadingKey('empty');
    try {
      await api.emptyTrash();
      refreshTrash();
    } catch (err) {
      addToast('error', `Failed to empty trash: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTrashLoadingKey(null);
    }
  }, [refreshTrash, addToast]);

  // Reserved for a future "+ new note" affordance; the redesign nav
  // dropped the root-create row in favour of the Graph entry.
  // const handleNewRootNote = useCallback(() => {
  //   window.dispatchEvent(new CustomEvent('kryton:new-note-root'));
  // }, []);

  // Top-level main-pane view (note | all | graph) — used by primary nav.
  const view = useUIStore(s => s.view);
  const setView = useUIStore(s => s.setView);
  const handleAllNotesClick = useCallback(() => setView('all'), [setView]);
  const handleGraphClick = useCallback(() => {
    setView(view === 'graph' ? 'note' : 'graph');
  }, [setView, view]);

  const uiTrashItems = trashItems.map(item => ({ path: item.path }));

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: 'var(--bg-1)',
        fontSize: 'var(--fs-base)',
        color: 'var(--fg-1)',
      }}
    >
      {/* 1. Brand row (44px to match prototype TopBar height) */}
      <div
        style={{
          height: 44, flexShrink: 0,
          padding: '10px 10px 6px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 1,
            padding: '4px 8px', borderRadius: 6, minWidth: 0,
          }}
        >
          <Icons.Logo size={18} />
          <span
            className="mono"
            style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14, letterSpacing: 0.3 }}
          >
            kryton
          </span>
          <span
            className="mono"
            style={{ color: 'var(--fg-4)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {version}
          </span>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse sidebar (Ctrl+B)"
            aria-label="Collapse sidebar"
            style={{
              width: 26, height: 26, borderRadius: 5,
              color: 'var(--fg-3)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
          >
            <Icons.PanelLeft size={14} />
          </button>
        )}
      </div>

      {/* 2. Primary nav (per prototype/app/sidebar.jsx) */}
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <NavRow
          icon={<Icons.Inbox size={14} />}
          label="All notes"
          hint={noteCount}
          active={view === 'all'}
          onClick={handleAllNotesClick}
        />
        <NavRow
          icon={<Icons.Calendar size={14} />}
          label="Daily note"
          hint="today"
          onClick={onDailyNote}
        />
        <NavRow
          icon={<Icons.Network size={14} />}
          label="Graph"
          active={view === 'graph'}
          onClick={handleGraphClick}
        />
        <NavRow
          icon={<Icons.Hash size={14} />}
          label="Tags"
        />
      </div>

      {/* 3. Divider */}
      <div style={{ height: 1, background: 'var(--line)', margin: '4px 12px' }} />

      {/* 4. Sections */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Favorites */}
        <div style={{ padding: '4px 4px 0' }}>
          <SectionHeader
            open={favOpen}
            setOpen={setFavOpen}
            label="Favorites"
            count={starredPaths.size}
          />
          {favOpen && (
            <div style={{ marginBottom: 4 }}>
              {starredPaths.size === 0 ? (
                <div
                  style={{
                    padding: '6px 12px',
                    color: 'var(--fg-4)',
                    fontSize: 11.5,
                    fontStyle: 'italic',
                  }}
                >
                  No favorites yet · Ctrl+Shift+S
                </div>
              ) : (
                <FavoritesSection
                  starredPaths={starredPaths}
                  onSelect={onSelect}
                  onToggleStar={onToggleStar}
                />
              )}
            </div>
          )}
        </div>

        {/* Files */}
        <div style={{ padding: '0 4px' }}>
          <SectionHeader
            open={filesOpen}
            setOpen={setFilesOpen}
            label="Files"
            count={noteCount}
          />
        </div>
        {filesOpen && (
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 80, padding: '0 4px' }}>
            <FileTree
              tree={tree}
              activeNotePath={activeNotePath}
              starredPaths={starredPaths}
              sharedNotes={sharedNotes}
              onSelect={onSelect}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onRenameNote={onRenameNote}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              onRenameFolder={onRenameFolder}
              onToggleStar={onToggleStar}
              onShare={onShare}
            />
          </div>
        )}

        <Resizer orientation="vertical" onResize={handleTagResize} />

        {/* Tags */}
        <div style={{ padding: '0 4px' }}>
          <SectionHeader open={tagsOpen} setOpen={setTagsOpen} label="Tags" />
        </div>
        {tagsOpen && (
          <div className="flex-shrink-0 overflow-hidden" style={{ height: `${tagPaneHeight}px` }}>
            <TagPane onNoteSelect={onSelect} />
          </div>
        )}

        {/* Trash */}
        <TrashList
          items={uiTrashItems}
          loadingKey={trashLoadingKey}
          onRestore={handleTrashRestore}
          onPermanentDelete={handleTrashDelete}
          onEmptyTrash={handleEmptyTrash}
        />
      </div>

      {/* plugin slot — sits between sections and the agents footer */}
      {beforeFooter}

      {/* 5. AgentsFooter (28px) */}
      <AgentsFooter />
    </div>
  );
}
