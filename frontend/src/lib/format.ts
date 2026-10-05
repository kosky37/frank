import type { VatRate } from '../../src-shared/tax/types.js';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

export function fmtMoney(n: number): string {
  return pln.format(n);
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const miesiacePl = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];

export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  const i = Number(m) - 1;
  if (!y || !(i >= 0 && i < 12)) return yyyyMm;
  return `${miesiacePl[i]} ${y}`;
}

/** Polska suma kontrolna NIP (wagi 6,5,7,2,3,4,5,6,7). */
export function isValidNip(nip: string): boolean {
  const d = nip.replace(/\D/g, '');
  if (!/^\d{10}$/.test(d)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
  const check = sum % 11;
  return check < 10 && check === Number(d[9]);
}

export const VAT_OPTIONS: { value: VatRate; label: string }[] = [
  { value: 0.23, label: '23%' },
  { value: 0.08, label: '8%' },
  { value: 0.05, label: '5%' },
  { value: 0, label: '0%' },
  { value: 'zw', label: 'zw.' },
  { value: 'np', label: 'np.' },
  { value: 'oo', label: 'oo.' },
];

export function vatLabel(v: VatRate): string {
  const f = VAT_OPTIONS.find((o) => o.value === v);
  if (f) return f.label;
  return typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v);
}
