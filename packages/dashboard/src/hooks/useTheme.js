import { useState, useCallback } from 'react';

const key = 'tokendash-theme';
const themes = ['dark', 'amber'];

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(key) || 'dark';
  });

  const toggle = useCallback(() => {
    setTheme(current => {
      const idx = themes.indexOf(current);
      const next = themes[(idx + 1) % themes.length];
      localStorage.setItem(key, next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
