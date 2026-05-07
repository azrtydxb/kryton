/**
 * UserMenu — pill-style user button per design handoff
 * (prototype/app/editor.jsx TopBar). The button is a 16px-radius
 * mono pill containing `<username>` text + a 22px gradient circle
 * with the user's first initial. The dropdown panel uses tokens.
 */
import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../hooks/useAuth';
import { useUIStore } from '../../stores/uiStore';
import { Icons } from '../Icons';

interface UserMenuProps {
  onAdminClick: () => void;
  onAccessRequestsClick: () => void;
}

const dropdownPanelStyle: CSSProperties = {
  background: 'var(--bg-1)',
  border: '1px solid var(--line-strong)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
  padding: 4,
  minWidth: 200,
};

const dropdownHeaderStyle: CSSProperties = {
  padding: '8px 10px 6px',
  borderBottom: '1px solid var(--line)',
  marginBottom: 4,
};

const dropdownItem: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 5,
  fontSize: 12.5,
  color: 'var(--fg-1)',
  textAlign: 'left',
  fontFamily: 'var(--font-mono)',
};

function MenuItem({
  onClick, icon, children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={dropdownItem}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: 'var(--fg-3)', display: 'inline-flex' }}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

function deriveDisplayName(name: string | null | undefined, email: string): string {
  if (name && name.trim().length > 0) {
    // First word of the user's full name (e.g. "Pascal Watteel" → "pascal")
    return name.trim().split(/\s+/)[0].toLowerCase();
  }
  return email.split('@')[0];
}

export function UserMenu({ onAdminClick, onAccessRequestsClick }: UserMenuProps) {
  const { user, logout } = useAuth();
  const setShowAccountSettings = useUIStore(s => s.setShowAccountSettings);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - 200),
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleLogout = useCallback(async () => {
    setOpen(false);
    await logout();
  }, [logout]);

  if (!user) return null;

  const displayName = deriveDisplayName(user.name, user.email);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        title={user.name || user.email}
        aria-label="User menu"
        className="mono"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '3px 4px 3px 10px',
          height: 30, borderRadius: 16,
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          color: 'var(--fg-1)',
          transition: 'border-color 120ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <span style={{ fontSize: 11, color: 'var(--fg-1)' }}>{displayName}</span>
        <span
          style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-fg)', fontWeight: 600, fontSize: 11,
            fontFamily: 'var(--font-mono)',
          }}
          aria-hidden="true"
        >
          {initial}
        </span>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top, left: dropdownPos.left,
            zIndex: 99999,
            ...dropdownPanelStyle,
          }}
        >
          <div style={dropdownHeaderStyle}>
            <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {user.name || displayName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {user.email}
            </div>
          </div>
          {user.role === 'admin' && (
            <MenuItem
              icon={<Icons.Settings size={12} />}
              onClick={() => { setOpen(false); onAdminClick(); }}
            >
              Admin Panel
            </MenuItem>
          )}
          <MenuItem
            icon={<Icons.Bot size={12} />}
            onClick={() => { setOpen(false); onAccessRequestsClick(); }}
          >
            Access Requests
          </MenuItem>
          <MenuItem
            icon={<Icons.Settings size={12} />}
            onClick={() => { setOpen(false); setShowAccountSettings(true); }}
          >
            Account Settings
          </MenuItem>
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={{ ...dropdownItem, textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ color: 'var(--fg-3)', display: 'inline-flex' }}>
              <Icons.Link size={12} />
            </span>
            <span>API Docs</span>
          </a>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <MenuItem
            icon={<Icons.X size={12} />}
            onClick={handleLogout}
          >
            Logout
          </MenuItem>
        </div>,
        document.body,
      )}
    </>
  );
}
