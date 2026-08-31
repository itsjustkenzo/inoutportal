import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

export const THEME_KEY = 'inout.theme';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function storedTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

export function ThemeProvider({ children }) {
  // Stored choice wins; otherwise follow the OS. Mirrors the inline script in index.html.
  const [theme, setThemeState] = useState(() => storedTheme() || (prefersDark() ? 'dark' : 'light'));
  const [hasChoice, setHasChoice] = useState(() => storedTheme() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Only an explicit pick is persisted, so "follow the OS" survives a reload.
  const setTheme = useCallback((next) => {
    localStorage.setItem(THEME_KEY, next);
    setHasChoice(true);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  useEffect(() => {
    if (hasChoice) return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setThemeState(e.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [hasChoice]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, isDark: theme === 'dark' }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
