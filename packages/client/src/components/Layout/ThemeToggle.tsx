import { Sun, Moon, Monitor } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const icon = theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />;

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={14} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
    { value: 'system', label: 'System', icon: <Monitor size={14} /> },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-ghost p-2"
        aria-label="Theme"
        title="Theme"
      >
        {icon}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setTheme(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                theme === opt.value ? 'text-blue-500 font-medium' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
