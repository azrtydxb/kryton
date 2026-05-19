/**
 * TopBar — matches `design_handoff_kryton_redesign/prototype/app/editor.jsx` TopBar.
 *
 * Layout (44px tall):
 *   [mobile menu] [sidebar toggle]  ~/notes › Welcome.md   [flex]
 *   ╭ command-palette button (320px wide, ⌘K kbd) ╮         [flex]
 *   [+ new note] [history] [theme] [settings] | [user pill]
 */
import { MutableRefObject, useCallback, useMemo } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { UserMenu } from './UserMenu';
import { IndexingPill } from './IndexingPill';
import { Icons } from '../Icons';
import { usePrefs } from '../../stores/prefsStore';
import { useUIStore } from '../../stores/uiStore';
import { formatShortcut } from '../../lib/platform';
import { PluginSlot } from '../PluginSlot/PluginSlot';
import { api } from '../../lib/api';
import {
  getAllPrefs,
  clearLegacyStorage,
} from '../../plugins/sidebarPrefs';

type Theme = 'light' | 'dark' | 'system';

interface HeaderProps {
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  searchInputRef: MutableRefObject<HTMLInputElement | undefined>;
  /** kept for API compatibility — current toggle reads/writes prefsStore directly */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onNoteSelect: (path: string) => void;
  onAdminClick: () => void;
  onAccessRequestsClick: () => void;
  /** optional sidebar-toggle wiring (rendered when provided) */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** optional ⌘K palette opener */
  onOpenPalette?: () => void;
  /** optional active note path to render in the breadcrumb */
  activeNotePath?: string | null;
  /** optional new-note callback */
  onNewNote?: () => void;
}

// isMac/modKey now live in lib/platform.ts — kept the import above.

/**
 * Per-prototype breadcrumb:  `~/notes › <filename>.md`
 * — the leading `~/notes` is mono `var(--fg-3)` 11.5px,
 * — the chevron is `var(--fg-4)`,
 * — the filename is mono `var(--fg-1)` 11.5px.
 */
function Breadcrumb({ activeNotePath }: { activeNotePath: string | null }) {
  const filename = useMemo(() => {
    if (!activeNotePath) return null;
    const parts = activeNotePath.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }, [activeNotePath]);

  return (
    <div
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        fontSize: 11.5, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--fg-3)' }}>~/notes</span>
      {filename && (
        <>
          <span style={{ color: 'var(--fg-4)' }}>›</span>
          <span style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {filename}
          </span>
        </>
      )}
    </div>
  );
}

/** 30×30 icon button per prototype `HeaderBtn`. */
function HeaderBtn({
  onClick, title, ariaLabel, active, disabled, dataAttr, children,
}: {
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  active?: boolean;
  disabled?: boolean;
  /** Optional data-* hook so other components can identify this button. */
  dataAttr?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
      disabled={disabled}
      data-header-btn={dataAttr}
      style={{
        width: 30, height: 30, borderRadius: 6,
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => {
        if (disabled || active) return;
        e.currentTarget.style.background = 'var(--bg-hover)';
        e.currentTarget.style.color = 'var(--fg)';
      }}
      onMouseLeave={e => {
        if (disabled || active) return;
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--fg-2)';
      }}
    >
      {children}
    </button>
  );
}

export function Header({
  // mobileMenuOpen/setMobileMenuOpen and onToggleSidebar are accepted for
  // API compatibility but no longer rendered — the prototype TopBar starts
  // with the breadcrumb and sidebar collapse lives in the sidebar itself.
  searchInputRef,
  onAdminClick, onAccessRequestsClick,
  onOpenPalette,
  activeNotePath,
  onNewNote,
}: HeaderProps) {
  const themePref = usePrefs(s => s.theme);
  const setPref = usePrefs(s => s.setPref);

  const handleToggleTheme = () => {
    setPref('theme', themePref === 'dark' ? 'light' : 'dark');
  };

  const handleOpenPalette = () => {
    if (onOpenPalette) onOpenPalette();
    else searchInputRef.current?.focus();
  };

  // History button toggles the per-note version dropdown via the UI store.
  // The PreviewModeView (or any view rendering a note) subscribes to the
  // same flag. When no note is active we disable the button.
  const showNoteHistory = useUIStore((s) => s.showNoteHistory);
  const setShowNoteHistory = useUIStore((s) => s.setShowNoteHistory);
  const setShowAccountSettings = useUIStore((s) => s.setShowAccountSettings);
  const sidebarEditMode = useUIStore((s) => s.sidebarEditMode);
  const setSidebarEditMode = useUIStore((s) => s.setSidebarEditMode);
  const historyDisabled = !activeNotePath;

  // Flush the current sidebar layout to the server when leaving edit mode.
  // We persist under a flat per-user key so the existing /api/settings/:key
  // endpoint can serve it; the regex was widened earlier to accept `:` in
  // keys for exactly this kind of namespaced UI setting.
  const handleToggleEditMode = useCallback(() => {
    if (sidebarEditMode) {
      const prefs = getAllPrefs();
      api
        .updateSetting('ui:sidebarLayout', JSON.stringify(prefs))
        .then(() => {
          // Drop the legacy v1 localStorage map once the server has the
          // truth — keeps us from having two sources of layout state.
          clearLegacyStorage();
        })
        .catch((err) => {
          console.warn('[sidebar] failed to persist layout:', err);
        });
    }
    setSidebarEditMode(!sidebarEditMode);
  }, [sidebarEditMode, setSidebarEditMode]);

  const kbdLabel = formatShortcut(['mod', 'K']);

  return (
    <header
      style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 10px 0 12px',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--line)',
        color: 'var(--fg-1)',
      }}
    >
      {/* breadcrumb (per prototype TopBar — no menu / sidebar-toggle here;
         sidebar collapse lives inside the sidebar's own brand row) */}
      <Breadcrumb activeNotePath={activeNotePath ?? null} />

      {/* spacer + centred command-palette button + spacer (per prototype) */}
      <div style={{ flex: 1 }} />
      <button
        onClick={handleOpenPalette}
        title={`Search or jump to (${kbdLabel})`}
        aria-label="Open command palette"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: 320, height: 30, padding: '0 10px',
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          borderRadius: 6, color: 'var(--fg-2)',
          transition: 'border-color 120ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icons.Search size={13} />
        <span className="mono" style={{ flex: 1, textAlign: 'left', fontSize: 12.5 }}>
          Search or jump to…
        </span>
        <span className="kbd">{kbdLabel}</span>
      </button>
      <div style={{ flex: 1 }} />

      {/* right cluster */}
      <IndexingPill />
      {/* Plugin-contributed topbar actions (e.g. Mass Upload) — rendered
          immediately before the New note "+" so always-visible global
          actions sit next to the search bar and primary +. */}
      <PluginSlot slot="topbar-actions" />
      {onNewNote && (
        <HeaderBtn onClick={onNewNote} title={`New note (${formatShortcut(['mod', 'shift', 'N'])})`} ariaLabel="New note">
          <Icons.Plus size={14} />
        </HeaderBtn>
      )}
      <HeaderBtn
        onClick={() => setShowNoteHistory(!showNoteHistory)}
        active={showNoteHistory && !historyDisabled}
        disabled={historyDisabled}
        title={historyDisabled ? 'Open a note to see its history' : 'Version history'}
        ariaLabel="Version history"
        // PreviewModeView's outside-click handler reads this attribute so it
        // doesn't pre-emptively close the panel before our onClick toggles.
        dataAttr="history-toggle"
      >
        <Icons.History size={14} />
      </HeaderBtn>
      <HeaderBtn
        onClick={handleToggleTheme}
        title={`Switch to ${themePref === 'dark' ? 'light' : 'dark'} theme`}
        ariaLabel="Toggle theme"
      >
        {themePref === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
      </HeaderBtn>
      <HeaderBtn
        onClick={() => setShowAccountSettings(true)}
        title="Settings"
        ariaLabel="Settings"
      >
        <Icons.Settings size={14} />
      </HeaderBtn>
      <HeaderBtn
        onClick={handleToggleEditMode}
        active={sidebarEditMode}
        title={sidebarEditMode ? 'Done — save layout' : 'Customize sidebar layout'}
        ariaLabel={sidebarEditMode ? 'Done — save layout' : 'Customize sidebar layout'}
      >
        <PanelsTopLeft size={14} strokeWidth={1.5} />
      </HeaderBtn>

      {/* divider */}
      <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />

      {/* user pill */}
      <UserMenu onAdminClick={onAdminClick} onAccessRequestsClick={onAccessRequestsClick} />
    </header>
  );
}
