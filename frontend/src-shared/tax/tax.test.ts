import { describe, expect, it } from 'vitest';
import { deductibleCostPit, deductibleVatCost, salesVat, vatDue, vatLimitUzycie } from './vat.js';
import { daninaSolidarnosciowa, pitRoczny, pitZaliczkaMiesieczna, porownajFormy } from './pit.js';
import { DEFAULT_SETTINGS, RATES_2026 } from './rates2026.js';
import { ryczaltZdrowotna, zdrowotnaMin } from './zus.js';
import type { CostInvoice } from './types.js';

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
  it('VAT 50%, PIT 75%', () => {
    expect(deductibleVatCost(costPaliwoMieszane)).toBe(115);
    expect(deductibleCostPit(costPaliwoMieszane)).toBe(750);
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
