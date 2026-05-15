import { useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, FileNode, TagData } from '../../lib/api';
import { FileTree, FavoritesSection, KRYTON_UI_VERSION } from '@azrtydxb/ui';
import { useUIStore } from '../../stores/uiStore';
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
  /**
   * Called when the user clicks a tag chip in the sidebar — should route
   * to the tags-filtered view (not load `#tag` as a note path, which 500s).
   */
  onTagSelect?: (tag: string) => void;
}

// Surfaced in the sidebar footer. Sourced from the @azrtydxb/ui package
// (which generates its version from its own package.json at build time)
// so client + ui can't drift apart silently.
const DEFAULT_VERSION = `v${KRYTON_UI_VERSION}`;

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
          color: 'inherit',
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
        <span className="mono" style={{ color: 'var(--fg-4)' }}>{count}</span>
      )}
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

/** 22×22 ghost icon button used for section-header actions (per prototype IconBtn). */
function IconBtn({
  onClick, title, children,
}: {
  onClick?: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 22, height: 22, borderRadius: 4,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--fg-3)',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
    >
      {children}
    </button>
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
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', height: 28,
        padding: '0 8px', borderRadius: 6,
        color: active ? 'var(--fg)' : 'var(--fg-2)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        textAlign: 'left',
        fontSize: 'var(--fs-base)',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && (
        <span
          style={{
            position: 'absolute', left: 0, top: 4, bottom: 4,
            width: 2, background: 'var(--accent)', borderRadius: 2,
          }}
        />
      )}
      <span style={{ color: active ? 'var(--accent)' : undefined, display: 'inline-flex' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint !== undefined && hint !== null && (
        <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 11 }}>{hint}</span>
      )}
    </button>
  );
}

/**
 * Sidebar footer — live MCP status driven by /api/agents:
 *   - mcp-health probe decides whether the chip is "MCP" (green-pulsing,
 *     transport reachable) or "MCP offline" (gray, transport down).
 *   - agents/online drives the "N agents online" count. The pluralisation
 *     and the count are real, not the hard-coded "2" mock.
 *
 * Both queries refetch every 10s. Failure modes:
 *   - mcp-health rejecting → chip turns gray "MCP offline".
 *   - online returning 0 → "0 agents online". (No avatar list — the prior
 *     "C / ↗" pills were decorative placeholders not tied to any client.)
 */
function AgentsFooter() {
  const healthQuery = useQuery({
    queryKey: ['mcp-health'],
    queryFn: () => api.getMcpHealth(),
    refetchInterval: 10_000,
    retry: 1,
  });
  const onlineQuery = useQuery({
    queryKey: ['agents-online'],
    queryFn: () => api.getAgentsOnline(),
    refetchInterval: 10_000,
    retry: 1,
  });
  const healthy = healthQuery.data?.status === 'ok';
  const count = onlineQuery.data?.count ?? 0;
  const titles = (onlineQuery.data?.clients ?? [])
    .map((c) => c.name || `${c.transport} session`)
    .join(', ');

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
        title={healthy ? 'MCP transport reachable' : 'MCP transport unreachable'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 6px', borderRadius: 3,
          background: healthy ? 'var(--accent-soft)' : 'var(--bg-2)',
          color: healthy ? 'var(--accent)' : 'var(--fg-3)',
          border: healthy ? 'none' : '1px solid var(--line)',
        }}
      >
        <span
          className={healthy ? 'dot pulse' : 'dot'}
          style={{
            display: 'inline-block',
            width: 5, height: 5, borderRadius: '50%',
            background: healthy ? 'var(--accent)' : 'var(--fg-4)',
            boxShadow: 'none',
          }}
        />
        {healthy ? 'MCP' : 'MCP offline'}
      </span>
      <span
        style={{ color: 'var(--fg-3)' }}
        title={titles || undefined}
      >
        {count} {count === 1 ? 'agent' : 'agents'} online
      </span>
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
  onTagSelect,
}: SidebarProps) {
  const [favOpen, setFavOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [tags, setTags] = useState<TagData[]>([]);

  const noteCount = useMemo(() => countNotes(tree), [tree]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTags()
      .then((t) => { if (!cancelled) setTags(t); })
      .catch(() => { if (!cancelled) setTags([]); });
    return () => { cancelled = true; };
  }, []);

  const dispatchCreateRootFile = useCallback(() => {
    window.dispatchEvent(new CustomEvent('kryton:create-root-file'));
  }, []);
  const dispatchCreateRootFolder = useCallback(() => {
    window.dispatchEvent(new CustomEvent('kryton:create-root-folder'));
  }, []);

  // Top-level main-pane view (note | all | graph) — used by primary nav.
  const view = useUIStore(s => s.view);
  const setView = useUIStore(s => s.setView);
  const handleAllNotesClick = useCallback(() => setView('all'), [setView]);
  const handleGraphClick = useCallback(() => {
    setView(view === 'graph' ? 'note' : 'graph');
  }, [setView, view]);
  const handleTagsClick = useCallback(() => {
    setView(view === 'tags' ? 'note' : 'tags');
  }, [setView, view]);

  return (
    <div
      data-kryton-sidebar
      style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--line)',
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
            style={{ fontWeight: 600, color: 'var(--fg)', letterSpacing: 0.5 }}
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
            title={`Collapse sidebar (${formatShortcut(['mod', 'B'])})`}
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
          hint={tags.length || undefined}
          active={view === 'tags'}
          onClick={handleTagsClick}
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
            <div style={{ marginBottom: 8 }}>
              {starredPaths.size === 0 ? (
                <div
                  style={{
                    padding: '6px 12px',
                    color: 'var(--fg-4)',
                    fontSize: 11.5,
                    fontStyle: 'italic',
                  }}
                >
                  No favorites yet · {formatShortcut(['mod', 'shift', 'S'])}
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
            actions={
              <div style={{ display: 'flex', gap: 2 }}>
                <IconBtn onClick={dispatchCreateRootFile} title={`New note (${formatShortcut(['mod', 'shift', 'N'])})`}>
                  <Icons.Plus size={12} />
                </IconBtn>
                <IconBtn onClick={dispatchCreateRootFolder} title="New folder">
                  <Icons.FolderPlus size={12} />
                </IconBtn>
              </div>
            }
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

        {/* Tags — chip cluster per prototype/app/sidebar.jsx Tags section */}
        <div style={{ padding: '0 4px' }}>
          <SectionHeader
            open={tagsOpen}
            setOpen={setTagsOpen}
            label="Tags"
            count={tags.length}
          />
          {tagsOpen && tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                padding: '2px 6px 8px',
              }}
            >
              {tags.slice(0, 11).map(({ tag, count }) => (
                <button
                  key={tag}
                  className="mono"
                  onClick={() => onTagSelect?.(tag)}
                  title={`#${tag} (${count})`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 7px 3px 6px',
                    borderRadius: 4,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    color: 'var(--fg-1)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    cursor: 'pointer',
                    transition: 'border-color 120ms, color 120ms',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--line)';
                    e.currentTarget.style.color = 'var(--fg-1)';
                  }}
                >
                  <span style={{ color: 'var(--fg-3)' }}>#</span>
                  {tag}
                  <span style={{ color: 'var(--fg-4)', marginLeft: 2 }}>{count}</span>
                </button>
              ))}
            </div>
          )}
          {tagsOpen && tags.length === 0 && (
            <div
              className="mono"
              style={{
                padding: '6px 10px 12px',
                color: 'var(--fg-4)',
                fontSize: 11.5,
                fontStyle: 'italic',
              }}
            >
              no tags yet
            </div>
          )}
        </div>
      </div>

      {/* plugin slot — sits between sections and the agents footer */}
      {beforeFooter}

      {/* 5. AgentsFooter (28px) */}
      <AgentsFooter />
    </div>
  );
}
