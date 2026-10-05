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
  const spoleczne = round2(settings.zusSpoleczneMies);
  const fp = round2(settings.zusFPMies);
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
  return { spoleczne, zdrowotna, fp, razem: round2(spoleczne + zdrowotna + fp), opis };
}
