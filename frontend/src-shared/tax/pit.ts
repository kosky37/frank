import type { CostInvoice, MonthlySums, SalesInvoice, TaxpayerSettings } from './types.js';
import { DEFAULT_SETTINGS, RATES_2026 } from './rates2026.js';
import { deductibleCostPit, deductibleVatCost, round2, salesVat } from './vat.js';
import { rocznyZusForma } from './zus.js';

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
    // Robocze i proformy nie wchodzą do PIT/VAT (proforma to oferta, nie sprzedaż).
    if (s.status === 'robocza' || s.rodzaj === 'proforma') continue;
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
    // wakacje składkowe: zwolniony miesiąc bez społecznych (zdrowotna liczona w ZUS osobno)
    zusSpoleczne: settings.wakacjeSkladkoweMiesiac === miesiac ? 0 : settings.zusSpoleczneMies,
    zusZdrowotna: settings.zusZdrowotnaMies,
    ryczaltSplit: [...split.entries()].map(([stawka, przychod]) => ({ stawka, przychod })),
  };
}

/** Agregat kwartalny (składa 3 miesiące; poziom UI — parzysty z sumą miesięcznych). */
export function aggregateQuarter(
  rok: string,
  kwartal: 1 | 2 | 3 | 4,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  settings: TaxpayerSettings,
): MonthlySums {
  const first = (kwartal - 1) * 3 + 1;
  const klucze = [first, first + 1, first + 2].map((m) => `${rok}-${String(m).padStart(2, '0')}`);
  const miesiace = klucze.map((k) => aggregateMonth(k, sales, costs, settings));
  const ryczaltSplit = mergeRyczaltSplit(miesiace);
  const sum = (f: (s: MonthlySums) => number): number => round2(miesiace.reduce((a, s) => a + f(s), 0));
  return {
    miesiac: `${rok}-Q${kwartal}`,
    przychodNetto: sum((s) => s.przychodNetto),
    kosztyNettoPit: sum((s) => s.kosztyNettoPit),
    vatNalezny: sum((s) => s.vatNalezny),
    vatNaliczony: sum((s) => s.vatNaliczony),
    zusSpoleczne: sum((s) => s.zusSpoleczne),
    zusZdrowotna: sum((s) => s.zusZdrowotna),
    ryczaltSplit,
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
  const podatek = podatekSkali(dochod);
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

/** Podatek wg skali rocznej od dochodu (PIT-36) — wspólny mianownik zaliczek i wspólnego rozliczenia. */
export function podatekSkali(dochod: number): number {
  const r = RATES_2026;
  const d = Math.max(0, round2(dochod));
  if (d <= r.skalaProg) return Math.max(0, round2(d * r.skalaStawka1 - r.kwotaZmniejszajaca));
  return round2(r.skalaProg * r.skalaStawka1 - r.kwotaZmniejszajaca + (d - r.skalaProg) * r.skalaStawka2);
}

/**
 * Wspólne rozliczenie małżonków (szacunek): 2 × podatek z połowy dochodu.
 * Dostępne tylko na skali — na liniowym i ryczałcie zablokowane (osobny PIT-36L/28).
 */
export function wspolneRozliczenie(dochod: number): { samodzielnie: number; wspolnie: number; korzysc: number } {
  const sam = podatekSkali(dochod);
  const wsp = round2(2 * podatekSkali(dochod / 2));
  return { samodzielnie: sam, wspolnie: wsp, korzysc: round2(sam - wsp) };
}

/** IP Box 5%: podatek od kwalifikowanego dochodu IP vs standard — z ewidencją IP i interpretacją. */
export function ulgaIpBox(
  kwalifikowanyDochod: number,
  forma: 'skala' | 'liniowy',
): { podatekNormalnie: number; podatekIpBox: number; oszczednosc: number } {
  const d = Math.max(0, round2(kwalifikowanyDochod));
  const normalnie = forma === 'liniowy' ? round2(d * RATES_2026.liniowyStawka) : podatekSkali(d);
  const ipbox = round2(d * 0.05);
  return { podatekNormalnie: normalnie, podatekIpBox: ipbox, oszczednosc: round2(normalnie - ipbox) };
}

/**
 * B+R: odliczenie kwalifikowanych kosztów od podstawy (szacunek 100% — mnożnik
 * i limit zweryfikuj z art. 26e/18d; CBR/status centrum badawczego pomijamy).
 */
export function odliczenieBR(kosztyKwalifikowane: number): number {
  return Math.max(0, round2(kosztyKwalifikowane));
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

export interface PelneObciazenie {
  pit: number;
  zus: number;
  danina: number;
  razem: number;
  formularz: RocznyPitResult['formularz'];
}

/**
 * Pełne obciążenie PIT + ZUS + danina dla każdej formy (szacunek do decyzji o formie).
 * ZUS liczony regułami formy: skala 9% / liniowy 4,9% / ryczałt tier — nie flat z ustawień.
 */
export function porownajPelneObciazenie(input: {
  przychod: number;
  koszty: number;
  zusSpoleczneMies: number;
  zusFPMies: number;
  zdrowMinMies: number;
  stawkaRyczaltu: number;
  ryczaltSplit?: { stawka: number; przychod: number }[];
  wakacje?: boolean;
  miesiace?: number;
}): Record<'skala' | 'liniowy' | 'ryczalt', PelneObciazenie> {
  const { przychod, koszty, zusSpoleczneMies, zusFPMies, zdrowMinMies, stawkaRyczaltu, ryczaltSplit, wakacje } = input;
  const m = Math.max(1, Math.min(12, Math.round(input.miesiace ?? 12) || 12));
  const spolRok = round2(zusSpoleczneMies * (wakacje ? Math.max(0, m - 1) : m));
  const mk = (forma: 'skala' | 'liniowy' | 'ryczalt'): PelneObciazenie => {
    const dochod = Math.max(0, round2(przychod - koszty - spolRok));
    const zus = rocznyZusForma(forma, dochod, Math.max(0, round2(przychod - spolRok)), zusSpoleczneMies, zusFPMies, zdrowMinMies, wakacje, m);
    const pit = pitRoczny({
      przychod,
      koszty,
      zusSpoleczneRok: zus.spoleczne,
      zusZdrowotnaRok: zus.zdrowotna,
      settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: forma, stawkaRyczaltu },
      ryczaltSplit,
    });
    const danina = pit.danina ?? 0;
    return { pit: pit.podatek, zus: zus.razem, danina, razem: round2(pit.podatek + zus.razem + danina), formularz: pit.formularz };
  };
  return { skala: mk('skala'), liniowy: mk('liniowy'), ryczalt: mk('ryczalt') };
}
