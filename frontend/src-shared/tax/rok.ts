import type { CostInvoice, MonthlySums, SalesInvoice, TaxpayerSettings } from './types.js';
import { RATES_2026 } from './rates2026.js';
import { aggregateMonth, mergeRyczaltSplit, ryczaltPodatek } from './pit.js';
import { costCashOut, round2 } from './vat.js';
import { zusMiesieczny } from './zus.js';

// Rozliczenie roku miesiąc po miesiącu — jedno źródło prawdy dla Pulpitu, Podatków i terminów.
// Zaliczki PIT liczone narastająco (art. 44 ust. 3a/3f updof), zdrowotna od dochodu
// z poprzedniego miesiąca (art. 81 ust. 2 i 2a ustawy o świadczeniach), VAT z przeniesieniem nadwyżki.

export interface MiesiacRoku {
  miesiac: string; // yyyy-mm
  /** sumy miesiąca w PLN; `zusZdrowotna` = faktycznie należna zdrowotna za miesiąc */
  sums: MonthlySums;
  /** przychód − koszty − społeczne (może być ujemny — strata obniża dochód narastająco) */
  dochod: number;
  zus: { spoleczne: number; zdrowotna: number; fp: number; razem: number };
  /** zaliczka PIT za ten okres (0 w miesiącach 1–2 kwartału przy zaliczkach kwartalnych) */
  pit: number;
  /** VAT do zapłaty za okres po odliczeniu nadwyżki z poprzedniego okresu */
  vat: number;
  /** nadwyżka VAT naliczonego przeniesiona na kolejny okres */
  vatNadwyzka: number;
  /** czy miesiąc kończy okres rozliczeniowy PIT / VAT (miesiąc albo koniec kwartału) */
  koniecOkresuPit: boolean;
  koniecOkresuVat: boolean;
}

export interface RozliczenieRoku {
  rok: number;
  miesiace: MiesiacRoku[];
  kwartalnyPit: boolean;
  kwartalnyVat: boolean;
  przychod: number;
  koszty: number;
  /** faktycznie wydane na koszty (brutto − odzyskany VAT) */
  kosztyGotowka: number;
  zusSpoleczne: number;
  zusZdrowotna: number;
  zusFp: number;
  zusRazem: number;
  pitZaliczki: number;
  vatDoZaplaty: number;
  vatNalezny: number;
  vatNaliczony: number;
  ryczaltSplit: { stawka: number; przychod: number }[];
}

function ym(rok: number, m: number): string {
  return `${rok}-${String(m).padStart(2, '0')}`;
}

/** Ostatni miesiąc roku do rozliczenia: bieżący (dla bieżącego roku) albo późniejszy, jeśli są już dokumenty. */
export function ostatniMiesiacRoku(rok: number, sales: SalesInvoice[], costs: CostInvoice[], dzisISO: string): number {
  const dzisRok = Number(dzisISO.slice(0, 4));
  if (rok < dzisRok) return 12;
  let max = rok === dzisRok ? Number(dzisISO.slice(5, 7)) : 0;
  const pref = `${rok}-`;
  for (const s of sales) if (s.dataSprzedazy.startsWith(pref)) max = Math.max(max, Number(s.dataSprzedazy.slice(5, 7)));
  for (const c of costs) if (c.dataKsiegowania.startsWith(pref)) max = Math.max(max, Number(c.dataKsiegowania.slice(5, 7)));
  return Math.min(12, max);
}

/** Pierwszy miesiąc roku: styczeń albo miesiąc rozpoczęcia działalności. */
export function pierwszyMiesiacRoku(rok: number, settings: TaxpayerSettings): number {
  const start = settings.dataRozpoczeciaDzialalnosci ?? '';
  if (/^\d{4}-\d{2}/.test(start) && Number(start.slice(0, 4)) === rok) return Number(start.slice(5, 7));
  return 1;
}

/** Podatek narastająco do zaliczki na skali: 12% − 300 zł/mies. do 120 000, potem 10 800 + 32% nadwyżki. */
export function podatekNarastajacoSkala(dochodYtd: number, liczbaMiesiecy: number): number {
  const r = RATES_2026;
  const d = Math.max(0, round2(dochodYtd));
  if (d <= r.skalaProg) {
    return Math.max(0, round2(d * r.skalaStawka1 - (r.kwotaZmniejszajaca / 12) * liczbaMiesiecy));
  }
  return round2(r.skalaProg * r.skalaStawka1 - r.kwotaZmniejszajaca + (d - r.skalaProg) * r.skalaStawka2);
}

function dochodMiesiaca(s: MonthlySums): number {
  return round2(s.przychodNetto - s.kosztyNettoPit - s.zusSpoleczne);
}

export function rozliczenieRoku(
  rok: number,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  settings: TaxpayerSettings,
  dzisISO: string,
): RozliczenieRoku {
  const od = pierwszyMiesiacRoku(rok, settings);
  const startRok = Number((settings.dataRozpoczeciaDzialalnosci ?? '').slice(0, 4));
  // rok przed rozpoczęciem działalności nie ma żadnych miesięcy
  const doM = startRok > rok ? 0 : ostatniMiesiacRoku(rok, sales, costs, dzisISO);
  const out: MiesiacRoku[] = [];
  const kwartalnyPit = settings.zaliczkaPit === 'kwartalna';
  const kwartalnyVat = settings.okresVat === 'kwartalny';

  // dochód z grudnia poprzedniego roku → zdrowotna za styczeń
  let dochodPoprz = od === 1 ? Math.max(0, dochodMiesiaca(aggregateMonth(ym(rok - 1, 12), sales, costs, settings))) : 0;
  let przychodYtd = 0;
  let spolYtd = 0;
  let zdrYtd = 0;
  let dochodYtd = 0;
  let pitZaplacone = 0;
  let vatNadwyzka = 0;
  let vatNalOkres = 0;
  let vatNalicOkres = 0;
  const splitYtd: MonthlySums[] = [];

  for (let m = od; m <= doM; m++) {
    const key = ym(rok, m);
    const base = aggregateMonth(key, sales, costs, settings);
    przychodYtd = round2(przychodYtd + base.przychodNetto);
    const spolYtdPrzed = spolYtd;
    const z = zusMiesieczny(
      settings,
      dochodPoprz,
      base.przychodNetto,
      key,
      settings.formaOpodatkowania === 'ryczalt' ? Math.max(0, round2(przychodYtd - spolYtdPrzed - base.zusSpoleczne)) : undefined,
    );
    const sums: MonthlySums = { ...base, zusSpoleczne: z.spoleczne, zusZdrowotna: z.zdrowotna };
    const dochod = dochodMiesiaca(sums);
    spolYtd = round2(spolYtd + z.spoleczne);
    zdrYtd = round2(zdrYtd + z.zdrowotna);
    dochodYtd = round2(dochodYtd + dochod);
    splitYtd.push(sums);

    const koniecOkresuPit = !kwartalnyPit || m % 3 === 0;
    let pit = 0;
    if (koniecOkresuPit) {
      let podatekYtd: number;
      if (settings.formaOpodatkowania === 'ryczalt') {
        const odliczenie = round2(spolYtd + zdrYtd * 0.5);
        const split = mergeRyczaltSplit(splitYtd);
        podatekYtd = ryczaltPodatek(
          split.length > 0 ? split : [{ stawka: settings.stawkaRyczaltu, przychod: przychodYtd }],
          settings.stawkaRyczaltu,
          odliczenie,
        );
      } else if (settings.formaOpodatkowania === 'liniowy') {
        const zdrOdl = Math.min(zdrYtd, RATES_2026.liniowyZdrowotnaLimitRoczny);
        podatekYtd = round2(Math.max(0, dochodYtd - zdrOdl) * RATES_2026.liniowyStawka);
      } else {
        podatekYtd = podatekNarastajacoSkala(dochodYtd, m - od + 1);
      }
      // zaliczki zaokrągla się do pełnych złotych (art. 63 § 1 Ordynacji)
      pit = Math.max(0, Math.round(podatekYtd - pitZaplacone));
      pitZaplacone += pit;
    }

    vatNalOkres = round2(vatNalOkres + base.vatNalezny);
    vatNalicOkres = round2(vatNalicOkres + base.vatNaliczony);
    const koniecOkresuVat = !kwartalnyVat || m % 3 === 0;
    let vat = 0;
    if (koniecOkresuVat) {
      if (settings.vatowiec) {
        const saldo = round2(vatNalOkres - vatNalicOkres - vatNadwyzka);
        // VAT do zapłaty też w pełnych złotych (P_51 w JPK)
        vat = saldo > 0 ? Math.round(saldo) : 0;
        vatNadwyzka = saldo < 0 ? round2(-saldo) : 0;
      }
      vatNalOkres = 0;
      vatNalicOkres = 0;
    }

    out.push({
      miesiac: key,
      sums,
      dochod,
      zus: { spoleczne: z.spoleczne, zdrowotna: z.zdrowotna, fp: z.fp, razem: z.razem },
      pit,
      vat,
      vatNadwyzka,
      koniecOkresuPit,
      koniecOkresuVat,
    });
    dochodPoprz = Math.max(0, dochod);
  }

  const sum = (f: (x: MiesiacRoku) => number): number => round2(out.reduce((a, x) => a + f(x), 0));
  const zakres = new Set(out.map((x) => x.miesiac));
  const kosztyGotowka = round2(
    costs.filter((c) => zakres.has(c.dataKsiegowania.slice(0, 7))).reduce((a, c) => a + costCashOut(c, settings.vatowiec), 0),
  );
  return {
    kosztyGotowka,
    rok,
    miesiace: out,
    kwartalnyPit,
    kwartalnyVat,
    przychod: sum((x) => x.sums.przychodNetto),
    koszty: sum((x) => x.sums.kosztyNettoPit),
    zusSpoleczne: sum((x) => x.zus.spoleczne),
    zusZdrowotna: sum((x) => x.zus.zdrowotna),
    zusFp: sum((x) => x.zus.fp),
    zusRazem: sum((x) => x.zus.razem),
    pitZaliczki: sum((x) => x.pit),
    vatDoZaplaty: sum((x) => x.vat),
    vatNalezny: sum((x) => x.sums.vatNalezny),
    vatNaliczony: sum((x) => x.sums.vatNaliczony),
    ryczaltSplit: mergeRyczaltSplit(out.map((x) => x.sums)),
  };
}

export interface Zobowiazanie {
  id: string;
  rodzaj: 'pit' | 'zus' | 'vat';
  tytul: string;
  /** okres, którego dotyczy (yyyy-mm albo yyyy-Qn) */
  okres: string;
  termin: string; // yyyy-mm-dd (przed przesunięciem na dzień roboczy)
  kwota: number;
}

function terminPo(miesiac: string, dzien: number): string {
  const [y, m] = miesiac.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(dzien).padStart(2, '0')}`;
}

/** Zobowiązania wynikające z rozliczenia (PIT 20., ZUS 20., VAT 25. po okresie). ID zgodne z kalendarzem Terminy. */
export function zobowiazaniaRoku(r: RozliczenieRoku): Zobowiazanie[] {
  const out: Zobowiazanie[] = [];
  for (const m of r.miesiace) {
    const q = Math.floor((Number(m.miesiac.slice(5, 7)) - 1) / 3) + 1;
    const terminPit = terminPo(m.miesiac, 20);
    const terminVat = terminPo(m.miesiac, 25);
    out.push({
      id: `${terminPit.slice(0, 7)}-zus`,
      rodzaj: 'zus',
      tytul: 'ZUS (DRA + przelew na NRS)',
      okres: m.miesiac,
      termin: terminPit,
      kwota: m.zus.razem,
    });
    const kwartal = `${m.miesiac.slice(0, 4)}-Q${q}`;
    if (m.koniecOkresuPit) {
      out.push({
        id: `${terminPit.slice(0, 7)}-pit`,
        rodzaj: 'pit',
        tytul: 'Zaliczka PIT (mikrorachunek)',
        okres: r.kwartalnyPit ? kwartal : m.miesiac,
        termin: terminPit,
        kwota: m.pit,
      });
    }
    if (m.koniecOkresuVat) {
      out.push({
        id: `${terminVat.slice(0, 7)}-vat`,
        rodzaj: 'vat',
        tytul: 'VAT (JPK_V7 + przelew na mikrorachunek)',
        okres: r.kwartalnyVat ? kwartal : m.miesiac,
        termin: terminVat,
        kwota: m.vat,
      });
    }
  }
  return out;
}
