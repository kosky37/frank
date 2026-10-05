import type { CostInvoice, MonthlySums, SalesInvoice, TaxpayerSettings } from './types.js';
import { DEFAULT_SETTINGS, RATES_2026 } from './rates2026.js';
import { deductibleCostPit, deductibleVatCost, round2, salesVat } from './vat.js';

export function monthKey(d: string): string {
  return d.slice(0, 7); // yyyy-mm-dd -> yyyy-mm
}

/** Suma miesięcznych rozbić ryczałtowych w roczne (per stawka). */
export function mergeRyczaltSplit(
  sums: MonthlySums[],
): { stawka: number; przychod: number }[] {
  const m = new Map<number, number>();
  for (const s of sums)
    for (const p of s.ryczaltSplit) m.set(p.stawka, round2((m.get(p.stawka) ?? 0) + p.przychod));
  return [...m.entries()].map(([stawka, przychod]) => ({ stawka, przychod }));
}

export function aggregateMonth(
  miesiac: string,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  settings: TaxpayerSettings,
): MonthlySums {
  let przychodNetto = 0;
  let vatNalezny = 0;
  const split = new Map<number, number>();
  for (const s of sales) {
    if (monthKey(s.dataSprzedazy) !== miesiac) continue;
    if (s.status === 'robocza') continue;
    const v = salesVat(s);
    przychodNetto += v.netto;
    vatNalezny += v.vat;
    if (settings.formaOpodatkowania === 'ryczalt') {
      for (const p of s.pozycje) {
        const line = round2(p.ilosc * p.cenaNetto);
        const stawka = p.stawkaRyczaltu && p.stawkaRyczaltu > 0 ? p.stawkaRyczaltu : settings.stawkaRyczaltu;
        split.set(stawka, round2((split.get(stawka) ?? 0) + line));
      }
    }
  }
  let kosztyNettoPit = 0;
  let vatNaliczony = 0;
  for (const c of costs) {
    if (monthKey(c.dataKsiegowania) !== miesiac) continue;
    kosztyNettoPit += deductibleCostPit(c);
    vatNaliczony += deductibleVatCost(c);
  }
  return {
    miesiac,
    przychodNetto: round2(przychodNetto),
    kosztyNettoPit: round2(kosztyNettoPit),
    vatNalezny: round2(vatNalezny),
    vatNaliczony: round2(vatNaliczony),
    zusSpoleczne: settings.zusSpoleczneMies,
    zusZdrowotna: settings.zusZdrowotnaMies,
    ryczaltSplit: [...split.entries()].map(([stawka, przychod]) => ({ stawka, przychod })),
  };
}

// ---------- PIT ----------

export interface PitResult {
  podstawa: number;
  podatek: number;
  efektywnaStawka: number;
  opis: string;
}

/**
 * Ryczałt per stawka; odliczenie ZUS rozdzielane proporcjonalnie do przychodu
 * (wymóg ewidencji przychodów wg stawek, art. 15 ustawy o zryczałtowanym PIT).
 */
export function ryczaltPodatek(
  split: { stawka: number; przychod: number }[],
  domyslnaStawka: number,
  odliczenie: number,
): number {
  const razem = round2(split.reduce((a, p) => a + p.przychod, 0));
  if (razem <= 0) return 0;
  const grup = new Map<number, number>();
  for (const p of split) grup.set(p.stawka, round2((grup.get(p.stawka) ?? 0) + p.przychod));
  let podatek = 0;
  for (const [stawka0, przychod] of grup) {
    const stawka = stawka0 > 0 ? stawka0 : domyslnaStawka;
    const podstawa = Math.max(0, round2(przychod - (odliczenie * przychod) / razem));
    podatek += round2(podstawa * stawka);
  }
  return round2(podatek);
}

/**
 * Miesięczna zaliczka PIT.
 * - skala: (dochód - ZUS społ.) * 12% - 1/12 kwoty zmniejszającej (32% rocznie)
 * - liniowy: (dochód - ZUS społ. - zdrowotna w limicie 14 100/rok) * 19%
 * - ryczałt: per stawka z pozycji, ZUS proporcjonalnie
 * Dochodowość roczna / progi rozliczane są w pitRoczny().
 */
export function pitZaliczkaMiesieczna(
  sums: MonthlySums,
  settings: TaxpayerSettings,
  odliczonaZdrowotnaNarastajaco = 0,
): PitResult {
  const r = RATES_2026;
  if (settings.formaOpodatkowania === 'ryczalt') {
    const odliczenie = round2(sums.zusSpoleczne + round2(sums.zusZdrowotna * 0.5));
    const podstawa = Math.max(0, round2(sums.przychodNetto - odliczenie));
    const split = sums.ryczaltSplit.length > 0
      ? sums.ryczaltSplit
      : [{ stawka: settings.stawkaRyczaltu, przychod: sums.przychodNetto }];
    const podatek = ryczaltPodatek(split, settings.stawkaRyczaltu, odliczenie);
    const ile = new Set(split.map((x) => x.stawka)).size;
    return {
      podstawa,
      podatek,
      efektywnaStawka: settings.stawkaRyczaltu,
      opis:
        ile > 1
          ? `Ryczałt ${ile} stawki (per pozycja) po odliczeniu ZUS społecznych i 50% zdrowotnej`
          : `Ryczałt ${(settings.stawkaRyczaltu * 100).toFixed(0)}% od przychodu po odliczeniu ZUS społecznych i 50% zdrowotnej`,
    };
  }
  const dochod = Math.max(0, round2(sums.przychodNetto - sums.kosztyNettoPit - sums.zusSpoleczne));
  if (settings.formaOpodatkowania === 'liniowy') {
    // zdrowotna do limitu rocznego 14 100: miesięcznie min(zdr, pozostały limit)
    const pozostalyLimit = Math.max(0, r.liniowyZdrowotnaLimitRoczny - odliczonaZdrowotnaNarastajaco);
    const zdr = Math.min(sums.zusZdrowotna, pozostalyLimit);
    const podstawa = Math.max(0, round2(dochod - zdr));
    const podatek = round2(podstawa * r.liniowyStawka);
    return { podstawa, podatek, efektywnaStawka: r.liniowyStawka, opis: 'Liniówka 19% od dochodu po ZUS społecznych i zdrowotnej w limicie 14 100/rok' };
  }
  // skala
  const miesiecznaUlga = round2(r.kwotaZmniejszajaca / 12);
  const podatek = Math.max(0, round2(dochod * r.skalaStawka1 - miesiecznaUlga));
  return {
    podstawa: dochod,
    podatek,
    efektywnaStawka: r.skalaStawka1,
    opis: 'Skala 12% (próg 32% rozliczany rocznie) minus 1/12 kwoty zmniejszającej',
  };
}

export interface RocznyPitInput {
  przychod: number;
  koszty: number;
  zusSpoleczneRok: number;
  zusZdrowotnaRok: number;
  settings: TaxpayerSettings;
  /** roczny przychód w rozbiciu na stawki ryczałtu (suma miesięcznych) */
  ryczaltSplit?: { stawka: number; przychod: number }[];
}

export interface RocznyPitResult extends PitResult {
  formularz: 'PIT-36' | 'PIT-36L' | 'PIT-28';
  skladkiOdliczone: number;
  /** danina solidarnościowa 4% powyżej 1M (osobny PIT-DS, informacyjnie) */
  danina?: number;
}

/** Danina solidarnościowa 4% od nadwyżki dochodu powyżej 1 000 000 (PIT-DS). */
export function daninaSolidarnosciowa(dochod: number): number {
  const r = RATES_2026;
  if (dochod <= r.daninaProg) return 0;
  return round2((dochod - r.daninaProg) * r.daninaStawka);
}

/** Roczny PIT — determinuje formularz i rozlicza progi. */
export function pitRoczny(input: RocznyPitInput): RocznyPitResult {
  const r = RATES_2026;
  const { przychod, koszty, zusSpoleczneRok, zusZdrowotnaRok, settings, ryczaltSplit } = input;
  if (settings.formaOpodatkowania === 'ryczalt') {
    const zdrowotnaOdliczona = round2(zusZdrowotnaRok * 0.5);
    const odliczenie = round2(zusSpoleczneRok + zdrowotnaOdliczona);
    const podstawa = Math.max(0, round2(przychod - odliczenie));
    const split = ryczaltSplit && ryczaltSplit.length > 0
      ? ryczaltSplit
      : [{ stawka: settings.stawkaRyczaltu, przychod }];
    const podatek = ryczaltPodatek(split, settings.stawkaRyczaltu, odliczenie);
    return {
      formularz: 'PIT-28',
      podstawa,
      podatek,
      efektywnaStawka: settings.stawkaRyczaltu,
      skladkiOdliczone: odliczenie,
      opis: `PIT-28: ryczałt ${(settings.stawkaRyczaltu * 100).toFixed(0)}%`,
    };
  }
  const dochod = Math.max(0, round2(przychod - koszty - zusSpoleczneRok));
  if (settings.formaOpodatkowania === 'liniowy') {
    const zdr = Math.min(zusZdrowotnaRok, r.liniowyZdrowotnaLimitRoczny);
    // uproszczenie: zdrowotna odliczana od podstawy w ramach limitu
    const podstawa = Math.max(0, round2(dochod - zdr));
    const podatek = round2(podstawa * r.liniowyStawka);
    return {
      formularz: 'PIT-36L',
      podstawa,
      podatek,
      efektywnaStawka: r.liniowyStawka,
      skladkiOdliczone: round2(zusSpoleczneRok + zdr),
      danina: daninaSolidarnosciowa(dochod),
      opis: 'PIT-36L: 19% flat, zdrowotna do limitu 14 100/rok',
    };
  }
  // skala z progiem 120k
  let podatek: number;
  if (dochod <= r.skalaProg) podatek = Math.max(0, round2(dochod * r.skalaStawka1 - r.kwotaZmniejszajaca));
  else
    podatek = round2(
      r.skalaProg * r.skalaStawka1 - r.kwotaZmniejszajaca + (dochod - r.skalaProg) * r.skalaStawka2,
    );
  return {
    formularz: 'PIT-36',
    podstawa: dochod,
    podatek,
    efektywnaStawka: dochod ? round2(podatek / dochod) : 0,
    skladkiOdliczone: zusSpoleczneRok,
    danina: daninaSolidarnosciowa(dochod),
    opis: 'PIT-36: skala 12% do 120k, 32% powyżej, kwota wolna 30k',
  };
}

/**
 * Porównywarka form opodatkowania na tych samych danych rocznych.
 * Zwraca podatek PIT dla każdej formy (+ danina gdzie dotyczy).
 * Ryczałt liczy od przychodu, skala/liniowy od dochodu — koszty ignorowane w ryczałcie.
 */
export function porownajFormy(input: Omit<RocznyPitInput, 'settings'> & { stawkaRyczaltu: number }): {
  skala: RocznyPitResult;
  liniowy: RocznyPitResult;
  ryczalt: RocznyPitResult;
} {
  const base = { ...input, ryczaltSplit: input.ryczaltSplit };
  const skala = pitRoczny({ ...base, settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'skala' } });
  const liniowy = pitRoczny({ ...base, settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'liniowy' } });
  const ryczalt = pitRoczny({
    ...base,
    settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'ryczalt', stawkaRyczaltu: input.stawkaRyczaltu },
  });
  return { skala, liniowy, ryczalt };
}
