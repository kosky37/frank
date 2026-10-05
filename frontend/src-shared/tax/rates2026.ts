import type { TaxpayerSettings } from './types.js';

// Domyślne parametry 2026. Wszystko konfigurowalne w Ustawieniach.
// Źródła: MF / ZUS / GUS na 2026 (zweryfikowane 2026-10-05, por. FEATURES.md rozdz. 3).
// UWAGA: styczeń ma inną zdrowotną minimalną (314,96) niż II–I (432,54) — rok składkowy.

export interface Rates2026 {
  skalaProg: number; // 120 000
  skalaStawka1: number; // 0.12
  skalaStawka2: number; // 0.32
  kwotaWolna: number; // 30 000
  kwotaZmniejszajaca: number; // 3 600
  liniowyStawka: number; // 0.19
  /** limit odliczenia składki zdrowotnej na liniowym (roczny) — 14 100 w 2026 */
  liniowyZdrowotnaLimitRoczny: number;
  /** ryczałt IT */
  ryczaltIT: number; // 0.12
  vatStandard: number; // 0.23
  /** pojazd mieszany: % VAT do odliczenia i % kosztu PIT */
  pojazdMieszanyVat: number; // 0.5
  pojazdMieszanyPit: number; // 0.75
  zusDuzySpoleczne: number; // em+rent+chor+wypad od bazy 5 652 = 1 788,29
  zusDuzyFP: number; // 2,45% od 5 652 = 138,47
  zusZdrowotnaMinLiniowy: number; // 432,54 (od II; styczeń 314,96)
  zusZdrowotnaMinRyczalt: number; // jw. (ryczałt ma własne tieri — patrz niżej)
  /** zdrowotna minimalna w styczniu (stary rok składkowy) */
  zusZdrowotnaMinStyczen: number; // 314,96
  /** zdrowotna ryczałt wg przychodu rocznego (przychód − społeczne): ≤60k / ≤300k / >300k */
  ryczaltZdrowotnaTiers: [number, number, number]; // [498.35, 830.58, 1495.04]
  /** limit zwolnienia podmiotowego VAT (od 1.01.2026: 240k, wcześniej 200k) */
  vatLimitZwolnienia: number;
  /** limit wejścia w ryczałt: 2M € = 8 517 200 zł */
  ryczaltLimitWejscia: number;
  /** danina solidarnościowa: próg + stawka */
  daninaProg: number; // 1 000 000
  daninaStawka: number; // 0.04
  /** preferencyjny ZUS: społeczne bez FP (~456,18 z chorobowym) */
  zusPreferencyjnySpoleczne: number;
  /** cap amortyzacji/leasingu aut wprowadzonych od 2026: EV / <50g / spalinowe */
  autoCapEv: number;
  autoCapNiskoemisyjne: number;
  autoCapSpalinowe: number;
}

export const RATES_2026: Rates2026 = {
  skalaProg: 120000,
  skalaStawka1: 0.12,
  skalaStawka2: 0.32,
  kwotaWolna: 30000,
  kwotaZmniejszajaca: 3600,
  liniowyStawka: 0.19,
  liniowyZdrowotnaLimitRoczny: 14100,
  ryczaltIT: 0.12,
  vatStandard: 0.23,
  pojazdMieszanyVat: 0.5,
  pojazdMieszanyPit: 0.75,
  zusDuzySpoleczne: 1788.29,
  zusDuzyFP: 138.47,
  zusZdrowotnaMinLiniowy: 432.54,
  zusZdrowotnaMinRyczalt: 432.54,
  zusZdrowotnaMinStyczen: 314.96,
  ryczaltZdrowotnaTiers: [498.35, 830.58, 1495.04],
  vatLimitZwolnienia: 240000,
  ryczaltLimitWejscia: 8517200,
  daninaProg: 1000000,
  daninaStawka: 0.04,
  zusPreferencyjnySpoleczne: 456.18,
  autoCapEv: 225000,
  autoCapNiskoemisyjne: 150000,
  autoCapSpalinowe: 100000,
};

export const DEFAULT_SETTINGS: TaxpayerSettings = {
  formaOpodatkowania: 'liniowy',
  stawkaRyczaltu: 0.12,
  vatowiec: true,
  okresVat: 'miesieczny',
  zaliczkaPit: 'miesieczna',
  zusSpoleczneMies: 1788.29,
  zusZdrowotnaMies: 432.54,
  zusFPMies: 138.47,
  zusSchemat: 'duzy',
  uzytkowaniePojazdu: 'mieszany',
  vat26Zgloszony: false,
};
