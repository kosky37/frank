import { describe, expect, it } from 'vitest';
import { deductibleCostPit, deductibleVatCost, salesVat, vatDue, vatLimitUzycie } from './vat.js';
import { aggregateMonth, aggregateQuarter, daninaSolidarnosciowa, odliczenieBR, pitRoczny, pitZaliczkaMiesieczna, podatekSkali, porownajFormy, porownajPelneObciazenie, ulgaIpBox, wspolneRozliczenie } from './pit.js';
import { DEFAULT_SETTINGS, RATES_2025, RATES_2026, stawkiNaRok } from './rates2026.js';
import { fpNalezny, rocznyZusForma, rozliczenieZdrowotnejRyczalt, ryczaltZdrowotna, skladkiSchematu, zdrowotnaMin, zusMiesieczny } from './zus.js';
import type { CostInvoice, TaxpayerSettings } from './types.js';

const costPaliwoMieszane: CostInvoice = {
  id: 'c1',
  numer: 'FV/1',
  wystawca: 'Orlen',
  dataZakupu: '2026-01-05',
  dataKsiegowania: '2026-01-05',
  kategoria: 'paliwo',
  pojazdowy: true,
  uzytkowaniePojazdu: 'mieszany',
  netto: 1000,
  stawkaVat: 0.23,
  opis: 'paliwo',
};

describe('pojazd mieszany', () => {
  it('VAT 50%, PIT 75% z netto + nieodliczonego VAT', () => {
    expect(deductibleVatCost(costPaliwoMieszane)).toBe(115);
    // 75% × (1000 + 115 nieodliczonego VAT)
    expect(deductibleCostPit(costPaliwoMieszane)).toBe(836.25);
  });
  it('nievatowiec: brak odliczenia VAT, koszt PIT = brutto', () => {
    const c = { ...costPaliwoMieszane, pojazdowy: false };
    expect(deductibleVatCost(c, false)).toBe(0);
    expect(deductibleCostPit(c, false)).toBe(1230);
  });
  it('paragon bez NIP: VAT nieodliczony wchodzi w koszt PIT', () => {
    const c = { ...costPaliwoMieszane, pojazdowy: false, vatNaliczonyDowolny: 0 };
    expect(deductibleCostPit(c)).toBe(1230);
  });
  it('niepojazdowy 100%', () => {
    const c = { ...costPaliwoMieszane, pojazdowy: false };
    expect(deductibleVatCost(c)).toBe(230);
    expect(deductibleCostPit(c)).toBe(1000);
  });
});

describe('VAT sprzedaż', () => {
  it('sumuje pozycje', () => {
    const v = salesVat({
      id: 'x',
      numer: '1/2026',
      kontrahent: { id: 'k', nazwa: 'Klient', nip: '123', adres: '' },
      dataWystawienia: '2026-01-01',
      dataSprzedazy: '2026-01-01',
      terminPlatnosci: '2026-01-15',
      pozycje: [{ nazwa: 'dev', ilosc: 1, cenaNetto: 20000, stawkaVat: 0.23 }],
      status: 'wystawiona',
    });
    expect(v).toEqual({ netto: 20000, vat: 4600, brutto: 24600 });
    expect(vatDue(v.vat, 115)).toBe(4485);
  });
});

describe('PIT', () => {
  it('liniowy 19% od dochodu po ZUS i zdrowotnej w limicie', () => {
    const r = pitZaliczkaMiesieczna(
      {
        miesiac: '2026-01',
        przychodNetto: 20000,
        kosztyNettoPit: 2000,
        vatNalezny: 0,
        vatNaliczony: 0,
        zusSpoleczne: 1773.96,
        zusZdrowotna: 314.96,
        ryczaltSplit: [],
      },
      { ...DEFAULT_SETTINGS, formaOpodatkowania: 'liniowy' },
    );
    // (20000-2000-1773.96-314.96)=15911.08 *19% = 3023.11
    expect(r.podatek).toBeCloseTo(3023.11, 2);
  });
  it('ryczałt 12% po ZUS i 50% zdrowotnej', () => {
    const r = pitZaliczkaMiesieczna(
      {
        miesiac: '2026-01',
        przychodNetto: 20000,
        kosztyNettoPit: 9999,
        vatNalezny: 0,
        vatNaliczony: 0,
        zusSpoleczne: 1000,
        zusZdrowotna: 400,
        ryczaltSplit: [],
      },
      { ...DEFAULT_SETTINGS, formaOpodatkowania: 'ryczalt', stawkaRyczaltu: 0.12 },
    );
    // podstawa 20000-1000-200=18800 *12%=2256
    expect(r.podstawa).toBe(18800);
    expect(r.podatek).toBe(2256);
  });
  it('ryczałt wiele stawek: ZUS proporcjonalnie', () => {
    const r = pitZaliczkaMiesieczna(
      {
        miesiac: '2026-02',
        przychodNetto: 30000,
        kosztyNettoPit: 0,
        vatNalezny: 0,
        vatNaliczony: 0,
        zusSpoleczne: 1000,
        zusZdrowotna: 400,
        ryczaltSplit: [
          { stawka: 0.12, przychod: 20000 },
          { stawka: 0.085, przychod: 10000 },
        ],
      },
      { ...DEFAULT_SETTINGS, formaOpodatkowania: 'ryczalt' },
    );
    // odliczenie 1200 → 12%: (20000-800)*12% = 2304; 8,5%: (10000-400)*8,5% = 816
    expect(r.podstawa).toBe(28800);
    expect(r.podatek).toBe(3120);
  });
  it('roczny skala z progiem', () => {
    const r = pitRoczny({
      przychod: 200000,
      koszty: 20000,
      zusSpoleczneRok: 20000,
      zusZdrowotnaRok: 10000,
      settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'skala' },
    });
    expect(r.formularz).toBe('PIT-36');
    // dochód 160k: 120k*12%-3600 +40k*32% = 14400-3600+12800=23600
    expect(r.podatek).toBe(23600);
  });
  it('roczny liniowy PIT-36L', () => {
    const r = pitRoczny({
      przychod: 240000,
      koszty: 24000,
      zusSpoleczneRok: 21287,
      zusZdrowotnaRok: 15000,
      settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'liniowy' },
    });
    expect(r.formularz).toBe('PIT-36L');
  });
  it('roczny ryczałt PIT-28', () => {
    const r = pitRoczny({
      przychod: 240000,
      koszty: 99999,
      zusSpoleczneRok: 20000,
      zusZdrowotnaRok: 6000,
      settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'ryczalt', stawkaRyczaltu: 0.12 },
    });
    expect(r.formularz).toBe('PIT-28');
    expect(r.podstawa).toBe(217000);
  });
  it('roczny ryczałt wiele stawek', () => {
    const r = pitRoczny({
      przychod: 360000,
      koszty: 0,
      zusSpoleczneRok: 20000,
      zusZdrowotnaRok: 6000,
      settings: { ...DEFAULT_SETTINGS, formaOpodatkowania: 'ryczalt' },
      ryczaltSplit: [
        { stawka: 0.12, przychod: 240000 },
        { stawka: 0.085, przychod: 120000 },
      ],
    });
    expect(r.formularz).toBe('PIT-28');
    expect(r.podstawa).toBe(337000);
    expect(r.podatek).toBe(36508.33);
  });
});

describe('2026: stawki i limity', () => {
  it('zdrowotna min: styczeń 314,96, od lutego 432,54', () => {
    expect(zdrowotnaMin('2026-01', 432.54)).toBe(314.96);
    expect(zdrowotnaMin('2026-02', 432.54)).toBe(432.54);
    expect(RATES_2026.liniowyZdrowotnaLimitRoczny).toBe(14100);
    expect(RATES_2026.zusDuzySpoleczne).toBe(1788.29);
    expect(RATES_2026.zusDuzyFP).toBe(138.47);
  });
  it('ryczałt zdrowotna tiers', () => {
    expect(ryczaltZdrowotna(50000)).toBe(498.35);
    expect(ryczaltZdrowotna(200000)).toBe(830.58);
    expect(ryczaltZdrowotna(500000)).toBe(1495.04);
  });
  it('danina 4% powyżej 1M', () => {
    expect(daninaSolidarnosciowa(900000)).toBe(0);
    expect(daninaSolidarnosciowa(1100000)).toBe(4000);
  });
  it('limit VAT 240k', () => {
    expect(vatLimitUzycie(240001).przekroczony).toBe(true);
    expect(vatLimitUzycie(216000).uzycie).toBeCloseTo(0.9, 5);
  });
  it('porównywarka: ryczałt najtańszy przy zerowych kosztach', () => {
    const p = porownajFormy({ przychod: 240000, koszty: 0, zusSpoleczneRok: 20000, zusZdrowotnaRok: 6000, stawkaRyczaltu: 0.12 });
    expect(p.ryczalt.podatek).toBeLessThan(p.liniowy.podatek);
    expect(p.skala.formularz).toBe('PIT-36');
  });
  it('art. 23: koszt reprezentacji nie wchodzi do PIT ani VAT', () => {
    const c: CostInvoice = {
      id: 'x', numer: 'FV/1', wystawca: 'Restauracja',
      dataZakupu: '2026-03-01', dataKsiegowania: '2026-03-01',
      kategoria: 'inne', pojazdowy: false, uzytkowaniePojazdu: 'mieszany',
      netto: 1000, stawkaVat: 0.23, opis: 'reprezentacja', nieodliczalnyArt23: true,
    };
    expect(deductibleCostPit(c)).toBe(0);
    expect(deductibleVatCost(c)).toBe(0);
  });
});

describe('REQUESTS: kwartały, wakacje, stawki roczne, pełne obciążenie', () => {
  const st: TaxpayerSettings = { ...DEFAULT_SETTINGS };
  function sprzedaz(m: string, netto: number) {
    return {
      id: `s-${m}`, numer: `${m}`, kontrahent: { id: 'k', nazwa: 'K', nip: '1111111111', adres: '' },
      dataWystawienia: `${m}-15`, dataSprzedazy: `${m}-15`, terminPlatnosci: `${m}-20`,
      pozycje: [{ nazwa: 'dev', ilosc: 1, cenaNetto: netto, stawkaVat: 0.23 as const }],
      status: 'wystawiona' as const,
    };
  }
  it('kwartał = suma 3 miesięcy', () => {
    const sales = [sprzedaz('2026-01', 20000), sprzedaz('2026-02', 20000), sprzedaz('2026-03', 20000)];
    const q = aggregateQuarter('2026', 1, sales, [], st);
    expect(q.miesiac).toBe('2026-Q1');
    expect(q.przychodNetto).toBe(60000);
    expect(q.vatNalezny).toBe(13800);
  });
  it('wakacje składkowe zerują społeczne (miesiąc + ZUS)', () => {
    const w: TaxpayerSettings = { ...st, wakacjeSkladkoweMiesiac: '2026-07' };
    const z = zusMiesieczny(w, 20000, undefined, '2026-07');
    expect(z.spoleczne).toBe(0);
    expect(z.fp).toBe(0);
    expect(z.zdrowotna).toBeGreaterThan(0);
    const zwykly = zusMiesieczny(w, 20000, undefined, '2026-08');
    expect(zwykly.spoleczne).toBeGreaterThan(0);
  });
  it('stawki na rok: 2025 vs 2026', () => {
    expect(stawkiNaRok(2025).zusDuzySpoleczne).toBe(RATES_2025.zusDuzySpoleczne);
    expect(stawkiNaRok(2026).zusDuzySpoleczne).toBe(RATES_2026.zusDuzySpoleczne);
    expect(stawkiNaRok(2024).vatLimitZwolnienia).toBe(200000);
  });
  it('pełne obciążenie: PIT+ZUS+danina, ryczałt liczy ZUS tierem', () => {
    const p = porownajPelneObciazenie({
      przychod: 240000, koszty: 24000,
      zusSpoleczneMies: 1788.29, zusFPMies: 138.47, zdrowMinMies: 432.54,
      stawkaRyczaltu: 0.12,
    });
    expect(p.liniowy.zus).toBeGreaterThan(0);
    // ryczałt: społeczne 1788,29 + tier 830,58 + FP 138,47 miesięcznie
    expect(p.ryczalt.zus).toBeCloseTo((1788.29 + 830.58 + 138.47) * 12, 0);
    expect(p.skala.razem).toBeCloseTo(p.skala.pit + p.skala.zus + p.skala.danina, 1);
    expect(rocznyZusForma('skala', 100000, 100000, 1788.29, 138.47, 432.54, true).spoleczne)
      .toBeCloseTo(1788.29 * 11, 2);
  });
});

describe('Batch G: proformy, skala, schematy, ulgi', () => {
  function sprzedaz(m: string, netto: number, extra = {}) {
    return {
      id: `s-${m}`, numer: `${m}`, kontrahent: { id: 'k', nazwa: 'K', nip: '1111111111', adres: '' },
      dataWystawienia: `${m}-15`, dataSprzedazy: `${m}-15`, terminPlatnosci: `${m}-20`,
      pozycje: [{ nazwa: 'dev', ilosc: 1, cenaNetto: netto, stawkaVat: 0.23 as const }],
      status: 'wystawiona' as const, ...extra,
    };
  }
  it('proforma nie wchodzi do PIT/VAT', () => {
    const st = { ...DEFAULT_SETTINGS };
    const sales = [sprzedaz('2026-01', 20000, { rodzaj: 'proforma' })];
    const s = aggregateMonth('2026-01', sales, [], st);
    expect(s.przychodNetto).toBe(0);
    expect(s.vatNalezny).toBe(0);
  });
  it('podatekSkali: 160k → 23600 (zgodnie z PIT-36)', () => {
    expect(podatekSkali(160000)).toBe(23600);
    expect(podatekSkali(0)).toBe(0);
  });
  it('wspólne rozliczenie: 2×podatek z połowy', () => {
    const w = wspolneRozliczenie(160000);
    // sam: 23600; wspólnie: 2×(80000×12%−3600)=2×6000=12000
    expect(w.samodzielnie).toBe(23600);
    expect(w.wspolnie).toBe(12000);
    expect(w.korzysc).toBe(11600);
  });
  it('IP Box 5%: 100k na liniowym → 5000 zamiast 19000', () => {
    const u = ulgaIpBox(100000, 'liniowy');
    expect(u.podatekNormalnie).toBe(19000);
    expect(u.podatekIpBox).toBe(5000);
    expect(u.oszczednosc).toBe(14000);
  });
  it('B+R: odliczenie kosztów kwalifikowanych', () => {
    expect(odliczenieBR(50000)).toBe(50000);
    expect(odliczenieBR(-5)).toBe(0);
  });
  it('preferencyjny: 456,18 bez FP', () => {
    const p = skladkiSchematu('preferencyjny');
    expect(p.spoleczne).toBe(456.18);
    expect(p.fp).toBe(0);
    expect(p.podstawa).toBe(1441.8);
  });
  it('mały plus: połowa śr. dochodu w widełkach', () => {
    const niski = skladkiSchematu('maly_plus', 1000);
    expect(niski.podstawa).toBeCloseTo(4806 * 0.3, 1);
    const sredni = skladkiSchematu('maly_plus', 10000);
    expect(sredni.podstawa).toBe(5000);
    expect(sredni.spoleczne).toBeCloseTo(5000 * 0.3164, 1);
    expect(sredni.fp).toBeCloseTo(5000 * 0.0245, 1);
    const wysoki = skladkiSchematu('maly_plus', 20000);
    expect(wysoki.podstawa).toBeCloseTo(9420 * 0.6, 1);
  });
  it('FP tylko od podstawy ≥ 4806', () => {
    expect(fpNalezny(5652)).toBeCloseTo(138.47, 1);
    expect(fpNalezny(4000)).toBe(0);
  });
  it('rozliczenie zdrowotnej ryczałt: tier × 12 vs zapłacone', () => {
    const r = rozliczenieZdrowotnejRyczalt(200000, 20000, 830.58 * 12);
    expect(r.miesieczna).toBe(830.58);
    expect(r.roznica).toBe(0);
    const doplata = rozliczenieZdrowotnejRyczalt(400000, 20000, 830.58 * 12);
    expect(doplata.miesieczna).toBe(1495.04);
    expect(doplata.roznica).toBeGreaterThan(0);
  });
});
