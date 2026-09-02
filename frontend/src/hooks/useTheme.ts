import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'theme';

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Current theme plus a setter. Light by default; a visitor's choice of dark
 * is remembered per browser. The <html> class is applied before
 * first paint by _document.tsx, so this hook only keeps React in sync.
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void; isSystem: boolean } {
  const [theme, setThemeState] = useState<Theme>('light');
  const [isSystem, setIsSystem] = useState(true);

  useEffect(() => {
    // Light is the site default; dark only when the visitor chose it.
    const stored = readStored();
    setIsSystem(stored === null);
    setThemeState(stored ?? 'light');
    apply(stored ?? 'light');
  }, []);

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    setIsSystem(false);
    setThemeState(t);
    apply(t);
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  return { theme, setTheme, toggle, isSystem };
}
