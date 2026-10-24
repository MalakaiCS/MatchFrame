'use client';
// Light and dark mode. The choice ('light' | 'dark' | 'system') is kept in this browser; the page's <html> carries
// the resolved theme in data-theme, set by THEME_SCRIPT before first paint so a light page never flashes dark.
// Dark is the default for a first visit (the brand's deep navy); 'system' follows the device and its changes.
import { useCallback, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';
const KEY = 'mf-theme';

/** Inline in <head>: resolves the stored choice and sets data-theme before anything is drawn. */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,t='dark';try{var c=localStorage.getItem('${KEY}');t=c==='light'||c==='dark'?c:c==='system'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){}d.dataset.theme=t;d.style.colorScheme=t})()`;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY);
    return c === 'light' || c === 'dark' || c === 'system' ? c : 'dark';
  } catch {
    return 'dark';
  }
}
const systemTheme = (): Theme => (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const resolve = (c: ThemeChoice): Theme => (c === 'system' ? systemTheme() : c);

function apply(theme: Theme) {
  const d = document.documentElement;
  if (d.dataset.theme === theme) return;
  d.classList.add('theme-switching');
  d.dataset.theme = theme;
  d.style.colorScheme = theme;
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.remove('theme-switching')));
}

let wired = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!wired && typeof window !== 'undefined') {
    wired = true;
    // another tab changed the choice, or the device switched while following the system
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      apply(resolve(readChoice()));
      emit();
    });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (readChoice() !== 'system') return;
      apply(systemTheme());
      emit();
    });
  }
  return () => void listeners.delete(l);
}

const snapshot = () => `${readChoice()}|${typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? 'dark') : 'dark'}`;

/** The visitor's choice and the theme in use, with a setter. Both read 'dark' while rendering on the server. */
export function useTheme() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'dark|dark');
  const [choice, theme] = snap.split('|') as [ThemeChoice, Theme];
  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    apply(resolve(c));
    emit();
  }, []);
  return { choice, theme, setChoice };
}
