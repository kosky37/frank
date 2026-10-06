import { useMemo } from 'react';
import { rozliczenieRoku, zobowiazaniaRoku, type RozliczenieRoku, type Zobowiazanie } from '../../src-shared/tax/rok.js';
import type { TaxpayerSettings } from '../../src-shared/tax/types.js';
import { czyNipPoprawny, mikrorachunek } from '../../src-shared/tax/integrations.js';
import { useStore } from './store.js';
import { todayISO } from './format.js';
import { przesunNaRoboczy } from './terminy.js';

/** Okres w tytule przelewu na mikrorachunek: 2026-09 → 26M09, 2026-Q3 → 26K03. */
export function okresPrzelewu(okres: string): string {
  const rr = okres.slice(2, 4);
  const q = /-Q(\d)$/.exec(okres);
  return q ? `${rr}K0${q[1]}` : `${rr}M${okres.slice(5, 7)}`;
}

export function symbolFormularza(rodzaj: Zobowiazanie['rodzaj'], settings: TaxpayerSettings): string {
  if (rodzaj === 'vat') return settings.okresVat === 'kwartalny' ? 'VAT-7K' : 'VAT-7';
  if (rodzaj === 'pit') {
    return settings.formaOpodatkowania === 'liniowy' ? 'PIT-36L' : settings.formaOpodatkowania === 'ryczalt' ? 'PIT-28' : 'PIT-36';
  }
  return 'DRA';
}

export interface Przelew {
  odbiorca: string;
  rachunek: string;
  kwota: number;
  tytul: string;
}

/** Dane do przelewu zobowiązania; null gdy brakuje NIP (mikrorachunek) albo NRS. */
export function przelewZobowiazania(z: Zobowiazanie, settings: TaxpayerSettings): Przelew | null {
  if (z.rodzaj === 'zus') {
    const nrs = (settings.zusNrs ?? '').replace(/\s/g, '');
    if (!nrs) return null;
    return { odbiorca: 'Zakład Ubezpieczeń Społecznych', rachunek: nrs, kwota: z.kwota, tytul: `Składki ZUS za ${z.okres}` };
  }
  const nip = (settings.firmaNip ?? '').replace(/\D/g, '');
  if (!czyNipPoprawny(nip)) return null;
  return {
    odbiorca: 'Urząd Skarbowy (mikrorachunek)',
    rachunek: mikrorachunek(nip),
    kwota: z.kwota,
    tytul: `N${nip} ${okresPrzelewu(z.okres)} ${symbolFormularza(z.rodzaj, settings)}`,
  };
}

export function przelewTekst(p: Przelew): string {
  return [`Odbiorca: ${p.odbiorca}`, `Rachunek: ${p.rachunek}`, `Kwota: ${p.kwota.toFixed(2)} PLN`, `Tytuł: ${p.tytul}`].join('\n');
}

export interface ZobowiazanieUI extends Zobowiazanie {
  /** termin po przesunięciu na dzień roboczy */
  terminRoboczy: string;
}

/** Rozliczenie wybranego roku liczone z bieżącego stanu (memo). */
export function useRozliczenie(rok: number): RozliczenieRoku {
  const { sales, costs, settings } = useStore();
  const dzis = todayISO();
  return useMemo(() => rozliczenieRoku(rok, sales, costs, settings, dzis), [rok, sales, costs, settings, dzis]);
}

/**
 * Zobowiązania z rozliczenia bieżącego i poprzedniego roku (grudzień płaci się w styczniu),
 * z terminami przesuniętymi na dni robocze.
 */
export function useZobowiazania(): ZobowiazanieUI[] {
  const { sales, costs, settings } = useStore();
  const dzis = todayISO();
  return useMemo(() => {
    const rok = Number(dzis.slice(0, 4));
    const poprzedniMaDane =
      sales.some((s) => s.dataSprzedazy.startsWith(`${rok - 1}-`)) ||
      costs.some((c) => c.dataKsiegowania.startsWith(`${rok - 1}-`));
    const lista = [
      ...(poprzedniMaDane ? zobowiazaniaRoku(rozliczenieRoku(rok - 1, sales, costs, settings, dzis)) : []),
      ...zobowiazaniaRoku(rozliczenieRoku(rok, sales, costs, settings, dzis)),
    ];
    return lista.map((z) => ({ ...z, terminRoboczy: przesunNaRoboczy(z.termin) }));
  }, [sales, costs, settings, dzis]);
}
