import { useState, useCallback } from 'react';

const key = 'tokendash-theme-v2';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(key) || 'light';
  });

  const toggle = useCallback(() => {
    setTheme(current => {
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(key, next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
