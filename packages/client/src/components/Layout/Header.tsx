import { MutableRefObject } from 'react';
import { SearchBar } from '../Search/SearchBar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { Menu } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

interface HeaderProps {
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  searchInputRef: MutableRefObject<HTMLInputElement | undefined>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onNoteSelect: (path: string) => void;
  onAdminClick: () => void;
  onAccessRequestsClick: () => void;
}

export function Header({
  mobileMenuOpen, setMobileMenuOpen,
  searchInputRef, theme, setTheme,
  onNoteSelect, onAdminClick, onAccessRequestsClick,
}: HeaderProps) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-3 border-b border-gray-700/50 bg-surface-900 text-gray-100 [&_.btn-ghost]:text-gray-400 [&_.btn-ghost:hover]:bg-gray-800">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="btn-ghost p-2 md:hidden"
          aria-label="Toggle menu"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center ml-1">
          <img src="/logo.png" alt="Mnemo" className="h-11 w-auto" />
        </div>
      </div>

      <div className="flex-1 max-w-md mx-2 md:mx-4">
        <SearchBar onSelect={onNoteSelect} inputRef={searchInputRef} />
      </div>

      <div className="flex items-center gap-0.5">
        <a
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost px-2 py-1 text-xs font-medium hidden md:inline-flex"
          title="API Docs"
        >
          API
        </a>
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <UserMenu onAdminClick={onAdminClick} onAccessRequestsClick={onAccessRequestsClick} />
      </div>
    </header>
  );
}
