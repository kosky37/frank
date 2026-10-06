import type { TaxpayerSettings } from './types.js';
import { RATES_2026 } from './rates2026.js';
import { round2 } from './vat.js';

// Składki ZUS 2026 — edytowalne w Ustawieniach.
// Zdrowotna zależy od formy: skala 9% dochodu (min), liniowy 4.9% (min), ryczałt tiers.
// Rok składkowy II–I: styczeń = stara minimalna 314,96; od lutego 432,54.

export interface ZusResult {
  spoleczne: number;
  zdrowotna: number;
  fp: number;
  razem: number;
  opis: string;
}

/** Minimalna zdrowotna dla danego miesiąca (yyyy-mm). */
export function zdrowotnaMin(miesiac: string, fallback: number): number {
  if (miesiac.endsWith('-01')) return RATES_2026.zusZdrowotnaMinStyczen;
  return Math.max(fallback, RATES_2026.zusZdrowotnaMinLiniowy);
}

/**
 * Zdrowotna ryczałtowca wg przychodu rocznego (przychód − społeczne):
 * ≤60k → 498,35; ≤300k → 830,58; powyżej → 1 495,04.
 */
export function ryczaltZdrowotna(przychodRocznyPoSpolecznych: number): number {
  const [t1, t2, t3] = RATES_2026.ryczaltZdrowotnaTiers;
  if (przychodRocznyPoSpolecznych <= 60000) return t1;
  if (przychodRocznyPoSpolecznych <= 300000) return t2;
  return t3;
}

/** Kod tytułu ubezpieczenia dla schematu ZUS (do DRA). */
export function zusKodTytulu(schemat: TaxpayerSettings['zusSchemat']): string {
  switch (schemat) {
    case 'start':
    case 'ulgowy':
      return '05 40';
    case 'preferencyjny':
      return '05 70';
    case 'maly_plus':
    case 'maly':
      return '05 90';
    default:
      return '01 10';
  }
}

export function zusMiesieczny(
  settings: TaxpayerSettings,
  dochodMies?: number,
  przychodMies?: number,
  miesiac = '',
  przychodRocznyPoSpolecznych?: number,
): ZusResult {
  // Ulga na start: tylko zdrowotna (społeczne + FP = 0).
  if (settings.zusSchemat === 'start' || settings.zusSchemat === 'ulgowy') {
    const zdrowotna = miesiac ? zdrowotnaMin(miesiac, settings.zusZdrowotnaMies) : round2(settings.zusZdrowotnaMies);
    return { spoleczne: 0, zdrowotna, fp: 0, razem: zdrowotna, opis: 'Ulga na start: tylko zdrowotna (6 mies.)' };
  }
  // Wakacje składkowe: 1 miesiąc w roku bez społecznych i FP, zdrowotna zostaje.
  const wakacje = miesiac !== '' && settings.wakacjeSkladkoweMiesiac === miesiac;
  const spoleczne = wakacje ? 0 : round2(settings.zusSpoleczneMies);
  const fp = wakacje ? 0 : round2(settings.zusFPMies);
  let zdrowotna: number;
  let opis: string;
  if (settings.formaOpodatkowania === 'skala') {
    // 9% dochodu, min. wg miesiąca (styczeń 314,96; od II 432,54)
    const base = dochodMies ?? 0;
    const min = miesiac ? zdrowotnaMin(miesiac, settings.zusZdrowotnaMies) : settings.zusZdrowotnaMies;
    zdrowotna = Math.max(min, round2(base * 0.09));
    opis = 'Zdrowotna skala: 9% dochodu (min. ustawieniowe)';
  } else if (settings.formaOpodatkowania === 'liniowy') {
    const base = dochodMies ?? 0;
    const min = miesiac ? zdrowotnaMin(miesiac, settings.zusZdrowotnaMies) : settings.zusZdrowotnaMies;
    zdrowotna = Math.max(min, round2(base * 0.049));
    opis = 'Zdrowotna liniowa: 4,9% dochodu (min. ustawieniowe)';
  } else {
    // ryczałt: tier z przychodu rocznego gdy znany, inaczej wartość z Ustawień
    void przychodMies;
    if (typeof przychodRocznyPoSpolecznych === 'number') {
      zdrowotna = ryczaltZdrowotna(przychodRocznyPoSpolecznych);
      opis = 'Zdrowotna ryczałt: tier z przychodu rocznego (498/831/1495)';
    } else {
      zdrowotna = round2(settings.zusZdrowotnaMies);
      opis = 'Zdrowotna ryczałt: wg przedziału przychodu (wartość z Ustawień)';
    }
  }
  return { spoleczne, zdrowotna, fp, razem: round2(spoleczne + zdrowotna + fp), opis: wakacje ? `${opis} + wakacje składkowe` : opis };
}

export interface RocznyZus {
  spoleczne: number;
  zdrowotna: number;
  fp: number;
  razem: number;
}

/**
 * Szacunkowy roczny ZUS dla danej formy (do porównywarki pełnego obciążenia).
 * Zdrowotna: skala 9% dochodu / liniowy 4,9% / ryczałt tier z przychodu (min. roczne).
 * Wakacje odejmują 1 miesiąc społecznych + FP. `miesiace` = liczba mies. YTD (domyślnie 12).
 */
export function rocznyZusForma(
  forma: TaxpayerSettings['formaOpodatkowania'],
  dochodRoczny: number,
  przychodRocznyPoSpolecznych: number,
  spoleczneMies: number,
  fpMies: number,
  zdrowMinMies: number,
  wakacje = false,
  miesiace = 12,
): RocznyZus {
  const m = Math.max(1, Math.min(12, Math.round(miesiace) || 12));
  const miesSpol = wakacje ? Math.max(0, m - 1) : m;
  const spoleczne = round2(spoleczneMies * miesSpol);
  const fp = round2(fpMies * miesSpol);
  const minRok = round2(zdrowMinMies * m);
  let zdrowotna: number;
  if (forma === 'skala') zdrowotna = Math.max(minRok, round2(dochodRoczny * 0.09));
  else if (forma === 'liniowy') zdrowotna = Math.max(minRok, round2(dochodRoczny * 0.049));
  else zdrowotna = round2(ryczaltZdrowotna(przychodRocznyPoSpolecznych) * m);
  return { spoleczne, zdrowotna, fp, razem: round2(spoleczne + zdrowotna + fp) };
}

/**
 * Składki z wyliczenia schematu (przycisk „Podstaw wyliczenie schematu” w Ustawieniach).
 * Preferencyjny: podstawa 30% płacy min, bez FP (24 mies.). Mały ZUS Plus: podstawa =
 * połowa śr. mies. dochodu, w widełkach [30% płacy min, 60% prognozy] (36 mies. w 60 mies.).
 */
export function skladkiSchematu(
  schemat: TaxpayerSettings['zusSchemat'],
  sredniDochodMiesieczny = 0,
): { spoleczne: number; fp: number; podstawa: number; opis: string } {
  const r = RATES_2026;
  if (schemat === 'preferencyjny') {
    return {
      spoleczne: r.zusPreferencyjnySpoleczne,
      fp: 0,
      podstawa: r.preferencyjnaBaza,
      opis: 'Preferencyjny: podstawa 30% płacy min, bez FP (24 mies.)',
    };
  }
  if (schemat === 'maly_plus' || schemat === 'maly') {
    const minPodstawa = round2(r.placaMinimalna * 0.3);
    const maxPodstawa = round2(r.przecietnePrognozowane * 0.6);
    const podstawa = Math.min(maxPodstawa, Math.max(minPodstawa, round2(sredniDochodMiesieczny * 0.5)));
    return {
      spoleczne: round2(podstawa * r.zusStopaSpol),
      fp: fpNalezny(podstawa),
      podstawa,
      opis: 'Mały ZUS Plus: podstawa = połowa śr. dochodu (36 mies. w 60 mies.)',
    };
  }
  if (schemat === 'duzy') {
    return {
      spoleczne: r.zusDuzySpoleczne,
      fp: r.zusDuzyFP,
      podstawa: round2(r.przecietnePrognozowane * 0.6),
      opis: 'Duży ZUS: pełna podstawa 60% prognozy',
    };
  }
  return { spoleczne: 0, fp: 0, podstawa: 0, opis: 'Ulga na start: tylko zdrowotna (6 mies.)' };
}

/** FP (+FS) 2,45% tylko gdy podstawa ≥ płaca minimalna — inaczej 0. */
export function fpNalezny(
  podstawa: number,
  stopa = RATES_2026.zusStopaFP,
  prog = RATES_2026.placaMinimalna,
): number {
  if (!(podstawa >= prog)) return 0;
  return round2(podstawa * stopa);
}

/**
 * Roczne rozliczenie zdrowotnej ryczałtowca: należna (tier × 12) vs zapłacona.
 * Dodatnia różnica = dopłata (DRA za kwiecień do 20 V), ujemna = wniosek o zwrot do 1 VI.
 */
export function rozliczenieZdrowotnejRyczalt(
  przychodRoczny: number,
  spoleczneRoczne: number,
  zaplacone: number,
): { miesieczna: number; naleznaRok: number; roznica: number } {
  const miesieczna = ryczaltZdrowotna(Math.max(0, round2(przychodRoczny - spoleczneRoczne)));
  const naleznaRok = round2(miesieczna * 12);
  const roznica = round2(naleznaRok - zaplacone);
  return { miesieczna, naleznaRok, roznica: roznica === 0 ? 0 : roznica };
}
