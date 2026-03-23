import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Shield } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface UserMenuProps {
  onAdminClick: () => void;
}

export function UserMenu({ onAdminClick }: UserMenuProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update dropdown position when opening
  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.right - 180,
      });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleLogout = useCallback(async () => {
    setOpen(false);
    await logout();
  }, [logout]);

  const handleAdminClick = useCallback(() => {
    setOpen(false);
    onAdminClick();
  }, [onAdminClick]);

  if (!user) return null;

  const initials = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="btn-ghost p-1.5 flex items-center gap-2"
        aria-label="User menu"
        title={user.name || user.email}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-semibold">
            {initials}
          </div>
        )}
        <span className="text-sm text-gray-200 hidden sm:inline truncate max-w-[120px]">
          {user.name || user.email}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 99999,
          }}
          className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 min-w-[180px]"
        >
          <div className="px-3 py-2 border-b border-gray-600">
            <div className="text-sm text-gray-200 font-medium truncate">{user.name}</div>
            <div className="text-xs text-gray-400 truncate">{user.email}</div>
          </div>
          {user.role === 'admin' && (
            <button
              onClick={handleAdminClick}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 transition-colors"
            >
              <Shield size={14} />
              Admin Panel
            </button>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 transition-colors"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
