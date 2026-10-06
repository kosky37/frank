import { useSyncExternalStore } from 'react';

// Routing po hashu: #/strona/zakladka — linki z Pulpitu prowadzą wprost do zakładki,
// a przycisk „wstecz” w przeglądarce działa.

export type Page =
  | 'pulpit' | 'sprzedaz' | 'koszty' | 'kontrahenci' | 'podatki'
  | 'terminy' | 'integracje' | 'ustawienia' | 'narzedzia';

const PAGES: Page[] = ['pulpit', 'sprzedaz', 'koszty', 'kontrahenci', 'podatki', 'terminy', 'integracje', 'ustawienia', 'narzedzia'];

export interface Route {
  page: Page;
  sub?: string;
  /** dodatkowa akcja, np. „nowa” (otwórz formularz) */
  akcja?: string;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const page = (PAGES as string[]).includes(parts[0] ?? '') ? (parts[0] as Page) : 'pulpit';
  return { page, sub: parts[1], akcja: parts[2] };
}

let current: Route = typeof location !== 'undefined' ? parseHash(location.hash) : { page: 'pulpit' };
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parseHash(location.hash);
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}

export function href(page: Page, sub?: string, akcja?: string): string {
  return `#/${[page, sub, akcja].filter(Boolean).map((x) => encodeURIComponent(x as string)).join('/')}`;
}

export function navigate(page: Page, sub?: string, akcja?: string): void {
  const h = href(page, sub, akcja);
  if (location.hash === h) return;
  location.hash = h;
}

/** Zakładka strony trzymana w URL (#/strona/zakladka); domyślna = pierwsza. */
export function useSubTab<T extends string>(page: Page, dozwolone: readonly T[], domyslna: T): [T, (t: T) => void] {
  const r = useRoute();
  const v = r.page === page && r.sub && (dozwolone as readonly string[]).includes(r.sub) ? (r.sub as T) : domyslna;
  return [v, (t: T) => navigate(page, t)];
}

/** Jednorazowa akcja z URL (np. #/sprzedaz/lista/nowa) — po odczycie czyści ją z adresu. */
export function zuzyjAkcje(page: Page, sub?: string): void {
  history.replaceState(null, '', href(page, sub));
  current = parseHash(location.hash);
  listeners.forEach((l) => l());
}
