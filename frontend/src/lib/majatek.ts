// Majątek JDG: amortyzacja środków trwałych + limity aut 2026 + ewidencja przebiegu.
// Czyste funkcje + kształty localStorage (testy w majatek.test.ts).

import { RATES_2026 } from '../../src-shared/tax/rates2026.js';
import { round2 } from '../../src-shared/tax/vat.js';

export type NapedAuta = 'ev' | 'niskoemisyjne' | 'spalinowe';

export interface LimitAuta {
  limit: number;
  nadwyzka: number;
  odliczalne: number;
  opis: string;
}

/**
 * Cap amortyzacji/leasingu aut wprowadzonych od 2026:
 * EV/wodór 225k, <50g CO₂ 150k, spalinowe 100k. Auta starsze: 150k/225k.
 */
export function limitAuta(naped: NapedAuta, wartosc: number, rokWprowadzenia: number): LimitAuta {
  const r = RATES_2026;
  const stare = rokWprowadzenia < 2026;
  const limit = naped === 'ev' ? r.autoCapEv : naped === 'niskoemisyjne' ? (stare ? r.autoCapEv : r.autoCapNiskoemisyjne) : stare ? r.autoCapNiskoemisyjne : r.autoCapSpalinowe;
  const w = Math.max(0, round2(wartosc));
  const nadwyzka = Math.max(0, round2(w - limit));
  const etykieta = naped === 'ev' ? 'EV/wodór' : naped === 'niskoemisyjne' ? '<50g CO₂' : 'spalinowe';
  return {
    limit,
    nadwyzka,
    odliczalne: round2(w - nadwyzka),
    opis: stare
      ? `Auto sprzed 2026 (${etykieta}): cap ${limit.toLocaleString('pl-PL')} zł`
      : `Auto od 2026 (${etykieta}): cap ${limit.toLocaleString('pl-PL')} zł`,
  };
}

// --- Rejestr środków trwałych ---

export type MetodaAmortyzacji = 'jednorazowa' | 'liniowa';

export interface SrodekTrwaly {
  id: string;
  nazwa: string;
  wartosc: number;
  dataNabycia: string; // yyyy-mm-dd
  metoda: MetodaAmortyzacji;
  /** roczna stawka % dla liniowej (np. 20 = laptop 5 lat) */
  stawkaRoczna?: number;
}

export interface OdpisRoczny {
  odpis: number;
  umorzenie: number;
  wartoscNetto: number;
}

/** Odpis za dany rok: jednorazowa = 100% w roku nabycia; liniowa = wartosc*stawka (pro-rata 1/12 za miesiąc nabycia — uproszczenie: pełny 1. rok). */
export function odpisZaRok(s: SrodekTrwaly, rok: number, umorzenieDotychczas = 0): OdpisRoczny {
  const rokNabycia = Number(s.dataNabycia.slice(0, 4));
  if (rok < rokNabycia) return { odpis: 0, umorzenie: round2(umorzenieDotychczas), wartoscNetto: round2(s.wartosc - umorzenieDotychczas) };
  const zostalo = Math.max(0, round2(s.wartosc - umorzenieDotychczas));
  const odpis = s.metoda === 'jednorazowa'
    ? (rok === rokNabycia ? zostalo : 0)
    : Math.min(zostalo, round2(s.wartosc * ((s.stawkaRoczna ?? 20) / 100)));
  const umorzenie = round2(umorzenieDotychczas + odpis);
  return { odpis: round2(odpis), umorzenie, wartoscNetto: round2(s.wartosc - umorzenie) };
}

// --- Ewidencja przebiegu (pojazd 100% + VAT-26) ---

export interface WpisPrzebiegu {
  id: string;
  data: string; // yyyy-mm-dd
  trasa: string;
  km: number;
  cel: string;
}

export function sumaKm(wpisy: WpisPrzebiegu[]): number {
  return round2(wpisy.reduce((a, w) => a + (w.km > 0 ? w.km : 0), 0));
}

export function ewidencjaCsv(wpisy: WpisPrzebiegu[]): string {
  const esc = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [...wpisy]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((w) => [w.data, w.trasa, String(w.km), w.cel].map(esc).join(';'));
  return ['data;trasa;km;cel', ...rows].join('\n') + '\n';
}
