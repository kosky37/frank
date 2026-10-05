import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'frank-theme';

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
    return 'dark';
  return 'light';
}

let theme: Theme = typeof localStorage !== 'undefined' ? initial() : 'light';
const listeners = new Set<() => void>();

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

if (typeof document !== 'undefined') apply();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTheme(): Theme {
  return theme;
}

export function toggleTheme(): void {
  theme = theme === 'light' ? 'dark' : 'light';
  apply();
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
