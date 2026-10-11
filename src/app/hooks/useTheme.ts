import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'contrast';
const KEY = 'app-theme';
const VALID: Theme[] = ['light', 'dark', 'contrast'];

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(KEY) as Theme;
    return VALID.includes(stored) ? stored : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState(t => (t === 'light' ? 'dark' : 'light'));

  return { theme, setTheme, toggleTheme };
}
