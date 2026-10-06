// Szybkie wygrane (Batch F) — czyste funkcje pomocnicze UI/silnika.
// Testowane w quickwins.test.ts. Bez zależności od DOM (localStorage tylko w logo, z guardem).

import { stawkiNaRok } from '../../src-shared/tax/rates2026.js';
import type { SalesInvoice } from '../../src-shared/tax/types.js';
import { round2 } from '../../src-shared/tax/vat.js';
import type { TerminIcs } from './batchE.js';

/** Pełne doby po terminie (0 gdy brak opóźnienia lub zły format). */
export function dniPoTerminie(terminISO: string, dzisISO?: string): number {
  const dzis = (dzisISO ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const termin = terminISO.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termin) || !/^\d{4}-\d{2}-\d{2}$/.test(dzis)) return 0;
  const ms = Date.parse(dzis) - Date.parse(termin);
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

export interface VatLimitProRata {
  limit: number;
  uzycie: number;
  przekroczony: boolean;
  /** true gdy limit przeskalowany przez start w trakcie roku */
  proRata: boolean;
  /** dni aktywności w roku (365/366 gdy cały rok) */
  dniAktywnosci: number;
}

/**
 * Limit zwolnienia VAT z pro-rata dla starterów: `limit_roczny/365*dni`
 * (dni od daty rozpoczęcia do 31 XII włącznie). Bez daty lub start
 * w innym roku — pełny limit roczny.
 */
export function vatLimitProRata(
  przychodYtdNetto: number,
  dataRozpoczecia?: string,
  rok?: number,
): VatLimitProRata {
  const start = (dataRozpoczecia ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const rokNum = rok ?? (m ? Number(m[1]) : new Date().getFullYear());
  const base = stawkiNaRok(rokNum).vatLimitZwolnienia;
  let limit = base;
  let proRata = false;
  let dni = 365;
  if (m && Number(m[1]) === rokNum) {
    const od = Date.parse(start);
    const doDnia = Date.parse(`${rokNum}-12-31`);
    dni = Math.max(1, Math.round((doDnia - od) / 86400000) + 1);
    limit = round2((base / 365) * dni);
    proRata = true;
  }
  return {
    limit,
    uzycie: limit ? przychodYtdNetto / limit : 0,
    przekroczony: przychodYtdNetto > limit,
    proRata,
    dniAktywnosci: dni,
  };
}

/** Liniowa ekstrapolacja YTD na pełne 12 miesięcy (prognoza cashflow). */
export function prognozaRoku(ytd: number, miesiaceYtd: number): number {
  if (!(miesiaceYtd > 0)) return 0;
  if (miesiaceYtd >= 12) return round2(ytd);
  return round2((ytd / miesiaceYtd) * 12);
}

/** Marża na rękę w % przychodu (0 przy zerowym przychodzie). */
export function marzaProcent(naReke: number, przychod: number): number {
  if (!(przychod > 0)) return 0;
  return round2((naReke / przychod) * 100);
}

/** Eksport terminów do CSV (separator `;`, cudzysłowy przy potrzebie). */
export function terminyCsv(terminy: TerminIcs[]): string {
  const esc = (v: string): string =>
    /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const rows = terminy.map((t) => [t.id, t.data, t.tytul, t.opis].map(esc).join(';'));
  return ['id;data;tytul;opis', ...rows].join('\n') + '\n';
}

function csvEsc(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Eksport faktur do CSV (do arkusza; import CSV dotyczy kosztów). */
export function sprzedazCsv(sales: SalesInvoice[]): string {
  const rows = sales.map((s) => {
    const netto = s.pozycje.reduce((a, p) => a + p.ilosc * p.cenaNetto, 0);
    return [s.numer, s.kontrahent.nazwa, s.kontrahent.nip, s.dataSprzedazy,
      String(Math.round(netto * 100) / 100), s.status, s.rodzaj ?? 'sprzedazy'].map(csvEsc).join(';');
  });
  return ['numer;kontrahent;nip;dataSprzedazy;netto;status;rodzaj', ...rows].join('\n') + '\n';
}

/** Eksport kosztów do CSV w formacie importu (numer;wystawca;data;netto;vat;kategoria). */
export function kosztyCsv(costs: import('../../src-shared/tax/types.js').CostInvoice[]): string {
  const rows = costs.map((c) => {
    const vat = typeof c.stawkaVat === 'number' ? String(Math.round(c.stawkaVat * 100)) : c.stawkaVat;
    return [c.numer, c.wystawca, c.dataKsiegowania, String(c.netto), vat, c.kategoria].map(csvEsc).join(';');
  });
  return ['numer;wystawca;data;netto;vat;kategoria', ...rows].join('\n') + '\n';
}

// --- Walidator 11 pól art. 106e ustawy o VAT ---

/**
 * Brakujące obowiązkowe pola faktury wg art. 106e (11 kontroli).
 * NIP nabywcy pomijany tylko dla paragonu — tu zawsze wymagany z adnotacją.
 */
export function brakiArt106e(
  inv: SalesInvoice,
  sprzedawca: { nazwa?: string; nip?: string; adres?: string },
): string[] {
  const braki: string[] = [];
  if (!inv.numer.trim()) braki.push('numer faktury');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.dataWystawienia)) braki.push('data wystawienia');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.dataSprzedazy)) braki.push('data sprzedaży');
  if (!(sprzedawca.nazwa ?? '').trim()) braki.push('nazwa sprzedawcy');
  if (!(sprzedawca.nip ?? '').trim()) braki.push('NIP sprzedawcy');
  if (!(sprzedawca.adres ?? '').trim()) braki.push('adres sprzedawcy');
  if (!inv.kontrahent.nazwa.trim()) braki.push('nazwa nabywcy');
  if (
    inv.pozycje.length === 0 ||
    inv.pozycje.some((p) => !p.nazwa.trim() || !(p.ilosc > 0) || !(p.cenaNetto >= 0))
  ) {
    braki.push('pozycje (nazwa/ilość/cena)');
  }
  const netto = inv.pozycje.reduce((a, p) => a + p.ilosc * p.cenaNetto, 0);
  if (!(netto > 0)) braki.push('wartość netto > 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.terminPlatnosci)) braki.push('termin płatności');
  if (!inv.kontrahent.nip.trim()) braki.push('NIP nabywcy (poza paragonem)');
  return braki;
}

// --- Logo firmy na wydruku (przechowywane lokalnie, nie wchodzi do API) ---

const LOGO_KEY = 'frank-firma-logo';

export function wczytajLogoUrl(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(LOGO_KEY) ?? '';
  } catch {
    return '';
  }
}

export function zapiszLogoUrl(url: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (url.trim()) localStorage.setItem(LOGO_KEY, url.trim());
    else localStorage.removeItem(LOGO_KEY);
  } catch {
    /* ignore */
  }
}

// --- Dowód sprawdzenia Białej Listy (>15k) + ZAW-NR ---

export interface DowodBL {
  id: string;
  dataSprawdzenia: string; // ISO timestamp
  nipKontrahenta: string;
  numerFaktury: string;
  brutto: number;
  rachunek?: string;
  kanal: 'biala-lista' | 'mpp';
}

/** Archiwizowalny dowód sprawdzenia (ID + timestamp) — do okazania przy kontroli. */
export function budujDowodBL(
  nipKontrahenta: string,
  numerFaktury: string,
  brutto: number,
  rachunek: string | undefined,
  kanal: DowodBL['kanal'],
): DowodBL {
  const ts = new Date().toISOString();
  return {
    id: `BL-${ts.slice(0, 10)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    dataSprawdzenia: ts,
    nipKontrahenta: nipKontrahenta.replace(/\D/g, ''),
    numerFaktury,
    brutto,
    rachunek,
    kanal,
  };
}

/** Termin ZAW-NR: 7 dni od dnia zlecenia przelewu >15k (escape zamiast MPP). */
export function zawNrDeadline(dataZleceniaISO: string): string {
  const d = new Date(`${dataZleceniaISO.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// --- Płatności: dane przelewu do skopiowania (stub PSD2 — status z banku wymaga API banku) ---

/** Tekstowe dane przelewu (kwota + rachunek + tytuł) — wklejasz w banku; status i tak odhaczasz ręcznie. */
export function danePrzelewu(rachunek: string, kwota: number, tytul: string, odbiorca: string): string {
  return [`Odbiorca: ${odbiorca}`, `Rachunek: ${rachunek}`, `Kwota: ${kwota.toFixed(2)} PLN`, `Tytuł: ${tytul}`].join('\n');
}

// --- Symulator etat vs B2B ---

export interface KosztPracodawcy {
  zusPracodawcy: number;
  kosztCalkowity: number;
}

/**
 * Szacunkowy koszt pracodawcy: emerytalne 9,76% + rentowe 6,5% + wypadkowe 1,67% +
 * FP 2,45% + FGŚP 0,1% ≈ 20,48% brutto (bez PPK, bez ulg).
 */
export function kosztPracodawcy(bruttoEtat: number): KosztPracodawcy {
  const b = Math.max(0, bruttoEtat);
  const zus = Math.round(b * 0.2048 * 100) / 100;
  return { zusPracodawcy: zus, kosztCalkowity: Math.round((b + zus) * 100) / 100 };
}

// --- Cykliczne faktury ---

export interface CyklFaktury {
  id: string;
  /** numer faktury-szablonu do kopiowania */
  szablonNumer: string;
  /** dzień miesiąca generowania (1–28) */
  dzienMiesiaca: number;
  aktywna: boolean;
  /** ostatni miesiąc wygenerowany (yyyy-mm) */
  ostatniWygenerowany?: string;
}

/** Miesiące do wygenerowania: od następnego po ostatnim do bieżącego (włącznie). */
export function nalezneCykle(cykle: CyklFaktury[], biezacyMiesiac: string): { cykl: CyklFaktury; miesiac: string }[] {
  const out: { cykl: CyklFaktury; miesiac: string }[] = [];
  for (const c of cykle) {
    if (!c.aktywna) continue;
    let [y, m] = (c.ostatniWygenerowany ?? '').split('-').map(Number);
    if (!y || !m) {
      const [by, bm] = biezacyMiesiac.split('-').map(Number);
      y = by; m = bm - 1;
      if (m < 1) { y -= 1; m = 12; }
    }
    for (;;) {
      m += 1;
      if (m > 12) { y += 1; m = 1; }
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > biezacyMiesiac) break;
      out.push({ cykl: c, miesiac: key });
      if (out.length > 24) break;
    }
  }
  return out;
}
