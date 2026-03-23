import { useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  const root = document.documentElement;
  
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  
  // Also update color-scheme for native elements
  document.body.style.colorScheme = resolved;
  
  console.log('Theme applied:', theme, '→ resolved:', resolved, 'classes:', root.className);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    const saved = localStorage.getItem('mnemo-theme') as Theme | null;
    const initial = saved || 'system';
    console.log('Initial theme from storage:', saved, '→ using:', initial);
    return initial;
  });

  const setTheme = useCallback((newTheme: Theme) => {
    console.log('setTheme called with:', newTheme);
    setThemeState(newTheme);
    localStorage.setItem('mnemo-theme', newTheme);
    applyTheme(newTheme);
  }, []);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  return { theme, setTheme, resolvedTheme };
}
