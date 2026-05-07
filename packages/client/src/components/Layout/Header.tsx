import { MutableRefObject, useMemo } from 'react';
import { SearchBar } from '../Search/SearchBar';
import { UserMenu } from './UserMenu';
import { Icons } from '../Icons';
import { usePrefs } from '../../stores/prefsStore';

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
  /** optional ⌘K palette opener (defaults to focusing the search input) */
  onOpenPalette?: () => void;
  /** optional active note path to render in the breadcrumb */
  activeNotePath?: string | null;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Breadcrumb({ activeNotePath }: { activeNotePath?: string | null }) {
  const segments = useMemo(() => {
    const parts: string[] = ['vault'];
    if (activeNotePath) {
      const clean = activeNotePath.replace(/\.md$/i, '');
      parts.push(...clean.split('/').filter(Boolean));
    }
    return parts;
  }, [activeNotePath]);

  return (
    <div
      className="mono"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
        fontSize: 'var(--fs-sm)', color: 'var(--fg-2)',
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}
    >
      {segments.map((seg, i) => (
        <span key={`${i}-${seg}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {i > 0 && <span style={{ color: 'var(--fg-4)' }}>/</span>}
          <span
            style={{
              overflow: 'hidden', textOverflow: 'ellipsis',
              color: i === segments.length - 1 ? 'var(--fg-1)' : 'var(--fg-2)',
            }}
          >
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}

function IconBtn({
  onClick, title, ariaLabel, children,
}: {
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      style={{
        width: 28, height: 28, borderRadius: 5,
        color: 'var(--fg-3)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
    >
      {children}
    </button>
  );
}

export function Header({
  mobileMenuOpen, setMobileMenuOpen,
  searchInputRef,
  onNoteSelect, onAdminClick, onAccessRequestsClick,
  onToggleSidebar,
  onOpenPalette,
  activeNotePath,
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

  const kbdLabel = isMac ? '⌘K' : 'Ctrl K';

  return (
    <header
      style={{
        height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 8px',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--line)',
        color: 'var(--fg-1)',
        fontSize: 'var(--fs-base)',
      }}
    >
      {/* mobile menu (narrow screens only) */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
        className="md:hidden"
        style={{
          width: 28, height: 28, borderRadius: 5,
          color: 'var(--fg-3)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Icons.Menu size={14} />
      </button>

      {/* sidebar toggle (desktop) */}
      {onToggleSidebar && (
        <div className="hidden md:inline-flex">
          <IconBtn
            onClick={onToggleSidebar}
            title="Toggle sidebar (Ctrl+B)"
            ariaLabel="Toggle sidebar"
          >
            <Icons.PanelLeft size={14} />
          </IconBtn>
        </div>
      )}

      {/* breadcrumb */}
      <Breadcrumb activeNotePath={activeNotePath ?? null} />

      {/* search — kept for parity; styled to fit topbar rhythm */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 480, marginLeft: 8 }}>
        <SearchBar onSelect={onNoteSelect} inputRef={searchInputRef} />
      </div>

      <div style={{ flex: 1 }} />

      {/* right-side controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* ⌘K palette opener */}
        <button
          onClick={handleOpenPalette}
          title={`Search or jump to (${kbdLabel})`}
          aria-label="Open command palette"
          className="mono"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 28, padding: '0 6px 0 9px', borderRadius: 5,
            background: 'transparent',
            border: '1px solid var(--line)',
            color: 'var(--fg-2)',
            fontSize: 11.5,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-strong)'; e.currentTarget.style.color = 'var(--fg-1)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg-2)'; }}
        >
          <Icons.Search size={12} />
          <span className="kbd">{kbdLabel}</span>
        </button>

        {/* theme toggle */}
        <IconBtn
          onClick={handleToggleTheme}
          title={`Switch to ${themePref === 'dark' ? 'light' : 'dark'} theme`}
          ariaLabel="Toggle theme"
        >
          {themePref === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
        </IconBtn>

        {/* api docs — small mono ghost button on wide screens */}
        <a
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="mono hidden md:inline-flex"
          title="API Documentation"
          aria-label="API Documentation (opens in new tab)"
          style={{
            alignItems: 'center', height: 28, padding: '0 8px', borderRadius: 5,
            color: 'var(--fg-3)', fontSize: 10.5, letterSpacing: '0.08em',
            textTransform: 'uppercase', textDecoration: 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg-1)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
        >
          api-docs
        </a>

        <UserMenu onAdminClick={onAdminClick} onAccessRequestsClick={onAccessRequestsClick} />
      </div>
    </header>
  );
}
