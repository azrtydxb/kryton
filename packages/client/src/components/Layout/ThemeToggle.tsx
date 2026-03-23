import { Sun, Moon, Monitor } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

type Theme = 'light' | 'dark' | 'system';

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
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
        left: rect.right - 140,
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

  const handleSelect = useCallback((value: Theme) => {
    setTheme(value);
    setOpen(false);
  }, [setTheme]);

  const icon = theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />;

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={14} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
    { value: 'system', label: 'System', icon: <Monitor size={14} /> },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="btn-ghost p-2"
        aria-label="Theme"
        title="Theme"
      >
        {icon}
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
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-2xl py-1 min-w-[140px]"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                theme === opt.value ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {opt.icon}
              {opt.label}
              {theme === opt.value && <span className="ml-auto text-blue-500">✓</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
