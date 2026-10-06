import { useSyncExternalStore } from 'react';
import type { TaxpayerSettings } from '../../src-shared/tax/types.js';
import type { TerminIcs } from './batchE.js';

export interface Termin extends TerminIcs {
  rodzaj: 'pit' | 'zus' | 'vat' | 'roczny' | 'info';
  /** kwota z rozliczenia (gdy znana) */
  kwota?: number;
  /** okres, którego dotyczy (yyyy-mm albo yyyy-Qn) */
  okres?: string;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera). */
export function wielkanoc(rok: number): Date {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(rok, miesiac - 1, dzien);
}

const cache = new Map<number, Set<string>>();

/** Dni ustawowo wolne od pracy w Polsce (ustawa z 18.01.1951, Wigilia od 2025). */
export function swietaPL(rok: number): Set<string> {
  const hit = cache.get(rok);
  if (hit) return hit;
  const stale = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26'];
  if (rok >= 2025) stale.push('12-24');
  const out = new Set(stale.map((x) => `${rok}-${x}`));
  const w = wielkanoc(rok);
  const przes = (dni: number): string => {
    const d = new Date(w);
    d.setDate(d.getDate() + dni);
    return iso(d);
  };
  out.add(przes(0)); // Wielkanoc
  out.add(przes(1)); // Poniedziałek Wielkanocny
  out.add(przes(49)); // Zielone Świątki
  out.add(przes(60)); // Boże Ciało
  cache.set(rok, out);
  return out;
}

export function czyDzienWolny(dataISO: string): boolean {
  const d = new Date(`${dataISO}T12:00:00`);
  const w = d.getDay();
  return w === 0 || w === 6 || swietaPL(d.getFullYear()).has(dataISO);
}

/** Termin przypadający na sobotę, niedzielę lub święto → następny dzień roboczy (art. 12 § 5 Ordynacji). */
export function przesunNaRoboczy(dataISO: string): string {
  const d = new Date(`${dataISO}T12:00:00`);
  while (czyDzienWolny(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Zgodność wsteczna: dzień `dzien` miesiąca, przesunięty na dzień roboczy. */
export function dzienRoboczy(rok: number, miesiac: number, dzien: number): string {
  const ostatni = new Date(rok, miesiac, 0).getDate();
  return przesunNaRoboczy(`${rok}-${String(miesiac).padStart(2, '0')}-${String(Math.min(dzien, ostatni)).padStart(2, '0')}`);
}

export const MIESIACE = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

/** Dopełniacz: „za październik” → używamy mianownika z małej litery, czytelnie w UI. */
function okresLabel(rok: number, m: number): string {
  const poprzM = m === 1 ? 12 : m - 1;
  const poprzR = m === 1 ? rok - 1 : rok;
  return `${MIESIACE[poprzM - 1].toLowerCase()} ${poprzR}`;
}

/**
 * Kalendarz obowiązków roku. Przy rozliczeniu kwartalnym PIT/VAT pojawiają się tylko
 * w miesiącach po kwartale (I, IV, VII, X). Kwoty dokleja się z rozliczenia (zobowiazaniaRoku).
 */
export function terminyRoku(rok: number, settings?: Pick<TaxpayerSettings, 'zaliczkaPit' | 'okresVat' | 'vatowiec'>): Termin[] {
  const kwPit = settings?.zaliczkaPit === 'kwartalna';
  const kwVat = settings?.okresVat === 'kwartalny';
  const vatowiec = settings?.vatowiec ?? true;
  const out: Termin[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const za = okresLabel(rok, m);
    const poKwartale = m % 3 === 1;
    const kwartal = m === 1 ? `Q4 ${rok - 1}` : `Q${Math.floor((m - 2) / 3) + 1} ${rok}`;
    out.push({
      id: `${rok}-${mm}-zus`, data: dzienRoboczy(rok, m, 20),
      tytul: `ZUS za ${za}`,
      opis: 'DRA + jeden przelew na indywidualny rachunek składkowy (NRS).', rodzaj: 'zus',
    });
    if (!kwPit || poKwartale) {
      out.push({
        id: `${rok}-${mm}-pit`, data: dzienRoboczy(rok, m, 20),
        tytul: kwPit ? `Zaliczka PIT za ${kwartal}` : `Zaliczka PIT za ${za}`,
        opis: 'Przelew na mikrorachunek podatkowy (bez deklaracji).', rodzaj: 'pit',
      });
    }
    if (vatowiec) {
      out.push({
        id: `${rok}-${mm}-vat`, data: dzienRoboczy(rok, m, 25),
        tytul: kwVat && poKwartale ? `JPK_V7K + VAT za ${kwartal}` : kwVat ? `JPK_V7K (ewidencja) za ${za}` : `JPK_V7M + VAT za ${za}`,
        opis: kwVat && !poKwartale
          ? 'Sama ewidencja (bez deklaracji i zapłaty) — kwartalna deklaracja po kwartale.'
          : 'Plik JPK z deklaracją + zapłata VAT na mikrorachunek.',
        rodzaj: 'vat',
      });
    }
  }
  const stale: Termin[] = [
    { id: `${rok}-epit-start`, data: `${rok}-02-15`, tytul: 'Twój e-PIT: start', opis: 'Od 15 lutego można złożyć zeznanie roczne PIT-36/36L/28.', rodzaj: 'roczny' },
    { id: `${rok}-pit-koniec`, data: przesunNaRoboczy(`${rok}-04-30`), tytul: `PIT roczny za ${rok - 1}`, opis: 'Zeznanie PIT-36 / 36L / 28 + dopłata podatku — do 30 kwietnia.', rodzaj: 'roczny' },
    { id: `${rok}-dra-roczna`, data: dzienRoboczy(rok, 5, 20), tytul: 'Roczne rozliczenie zdrowotnej', opis: 'W DRA za kwiecień — do 20 maja.', rodzaj: 'zus' },
    { id: `${rok}-zwrot`, data: przesunNaRoboczy(`${rok}-06-01`), tytul: 'Wniosek o zwrot nadpłaty zdrowotnej', opis: 'RZS-R — do 1 czerwca (ZUS zwraca do 30 czerwca).', rodzaj: 'zus' },
  ];
  if (rok === 2026) {
    stale.push(
      { id: '2026-ksef-odbior', data: '2026-02-01', tytul: 'KSeF: obowiązek odbioru', opis: 'Od 1.02.2026 faktury zakupowe odbierasz w KSeF.', rodzaj: 'info' },
      { id: '2026-ksef-wyst', data: '2026-04-01', tytul: 'KSeF: obowiązek wystawiania', opis: 'Od 1.04.2026 obowiązkowe wystawianie faktur w KSeF.', rodzaj: 'info' },
      { id: '2026-edorec', data: '2026-10-01', tytul: 'e-Doręczenia', opis: 'Obowiązkowy adres do e-Doręczeń wpisany w CEIDG.', rodzaj: 'info' },
      { id: '2026-pkd', data: '2026-12-31', tytul: 'CEIDG: PKD 2025', opis: 'Aktualizacja kodów PKD — do 31.12.2026.', rodzaj: 'info' },
    );
  }
  out.push(...stale);
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.tytul.localeCompare(b.tytul));
}

// --- odhaczone terminy: wspólny stan dla Pulpitu i kalendarza ---

const KEY = 'frank-terminy';
const listeners = new Set<() => void>();

function wczytaj(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

let odhaczone: Record<string, boolean> = typeof localStorage !== 'undefined' ? wczytaj() : {};

export function przelaczTermin(id: string, wartosc?: boolean): void {
  odhaczone = { ...odhaczone, [id]: wartosc ?? !odhaczone[id] };
  try {
    localStorage.setItem(KEY, JSON.stringify(odhaczone));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useOdhaczone(): Record<string, boolean> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => odhaczone,
    () => odhaczone,
  );
}
