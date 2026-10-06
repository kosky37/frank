import { describe, expect, it } from 'vitest';
import { aggregateMonth } from './pit.js';
import { DEFAULT_SETTINGS } from './rates2026.js';
import { podatekNarastajacoSkala, rozliczenieRoku, zobowiazaniaRoku } from './rok.js';
import { brakKursu, salesVatPln } from './vat.js';
import type { SalesInvoice, TaxpayerSettings } from './types.js';

function fv(miesiac: string, netto: number, extra: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: `fv-${miesiac}`,
    numer: `1/${miesiac.slice(5, 7)}/${miesiac.slice(0, 4)}`,
    kontrahent: { id: 'k', nazwa: 'Klient', nip: '5250000000', adres: 'Warszawa' },
    dataWystawienia: `${miesiac}-28`,
    dataSprzedazy: `${miesiac}-28`,
    terminPlatnosci: `${miesiac}-28`,
    pozycje: [{ nazwa: 'dev', ilosc: 1, cenaNetto: netto, stawkaVat: 0.23 }],
    status: 'wystawiona',
    ...extra,
  };
}

const rokFaktur = (netto: number): SalesInvoice[] =>
  Array.from({ length: 12 }, (_, i) => fv(`2026-${String(i + 1).padStart(2, '0')}`, netto));

describe('faktury walutowe', () => {
  it('przelicza netto i VAT na PLN kursem NBP', () => {
    const inv = fv('2026-03', 1000, { waluta: 'EUR', kursNbp: 4.3 });
    expect(salesVatPln(inv)).toEqual({ netto: 4300, vat: 989, brutto: 5289 });
    expect(aggregateMonth('2026-03', [inv], [], DEFAULT_SETTINGS).przychodNetto).toBe(4300);
  });
  it('wykrywa brak kursu', () => {
    expect(brakKursu(fv('2026-03', 1000, { waluta: 'EUR' }))).toBe(true);
    expect(brakKursu(fv('2026-03', 1000))).toBe(false);
  });
});

describe('zaliczki narastająco', () => {
  it('skala: 32% po przekroczeniu 120 000 w trakcie roku', () => {
    expect(podatekNarastajacoSkala(100000, 10)).toBe(9000);
    expect(podatekNarastajacoSkala(150000, 12)).toBe(20400);
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, formaOpodatkowania: 'skala' };
    const r = rozliczenieRoku(2026, rokFaktur(20000), [], s, '2026-12-31');
    const pierwsza = r.miesiace[0].pit;
    const ostatnia = r.miesiace[11].pit;
    // grudzień: dochód narastająco > 120k → zaliczka po 32% wyższa niż styczniowa po 12%
    expect(ostatnia).toBeGreaterThan(pierwsza * 2);
    // suma zaliczek = podatek narastająco za cały rok (zaokrąglenia do zł)
    const dochodRok = r.miesiace.reduce((a, m) => a + m.dochod, 0);
    expect(Math.abs(r.pitZaliczki - podatekNarastajacoSkala(dochodRok, 12))).toBeLessThanOrEqual(6);
  });
  it('strata w miesiącu obniża kolejne zaliczki (narastająco)', () => {
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, formaOpodatkowania: 'liniowy' };
    const sales = [fv('2026-01', 20000), fv('2026-03', 20000)];
    const r = rozliczenieRoku(2026, sales, [], s, '2026-03-31');
    // luty bez przychodu: brak zaliczki, a marcowa pomniejszona o lutowe składki
    expect(r.miesiace[1].pit).toBe(0);
    expect(r.miesiace[2].pit).toBeLessThan(r.miesiace[0].pit);
  });
  it('kwartalne: zaliczka tylko w miesiącu kończącym kwartał', () => {
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, zaliczkaPit: 'kwartalna', okresVat: 'kwartalny' };
    const r = rozliczenieRoku(2026, rokFaktur(15000).slice(0, 6), [], s, '2026-06-30');
    expect(r.miesiace.map((m) => m.pit > 0)).toEqual([false, false, true, false, false, true]);
    expect(r.miesiace.map((m) => m.vat > 0)).toEqual([false, false, true, false, false, true]);
    const z = zobowiazaniaRoku(r).filter((x) => x.rodzaj === 'pit');
    expect(z.map((x) => x.okres)).toEqual(['2026-Q1', '2026-Q2']);
  });
});

describe('zdrowotna i zakres miesięcy', () => {
  it('zdrowotna za miesiąc liczona od dochodu z poprzedniego miesiąca', () => {
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, formaOpodatkowania: 'skala' };
    const r = rozliczenieRoku(2026, [fv('2026-02', 30000)], [], s, '2026-03-31');
    // luty: dochód styczniowy ≤ 0 → minimum; marzec: 9% dochodu z lutego
    expect(r.miesiace[1].zus.zdrowotna).toBe(432.54);
    expect(r.miesiace[2].zus.zdrowotna).toBe(Math.round((30000 - s.zusSpoleczneMies) * 0.09 * 100) / 100);
  });
  it('liczy wszystkie miesiące do dziś, także bez dokumentów (ZUS płacisz zawsze)', () => {
    const r = rozliczenieRoku(2026, [fv('2026-01', 10000)], [], DEFAULT_SETTINGS, '2026-10-06');
    expect(r.miesiace).toHaveLength(10);
    expect(r.zusSpoleczne).toBeCloseTo(DEFAULT_SETTINGS.zusSpoleczneMies * 10, 2);
  });
  it('start działalności w trakcie roku zawęża zakres', () => {
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, dataRozpoczeciaDzialalnosci: '2026-07-01' };
    expect(rozliczenieRoku(2026, [], [], s, '2026-10-06').miesiace[0].miesiac).toBe('2026-07');
  });
  it('VAT: nadwyżka naliczonego przechodzi na kolejny miesiąc', () => {
    const koszt = {
      id: 'c', numer: 'FV', wystawca: 'X', nipWystawcy: '5250000000', dataZakupu: '2026-01-10', dataKsiegowania: '2026-01-10',
      kategoria: 'sprzet' as const, pojazdowy: false, uzytkowaniePojazdu: 'mieszany' as const, netto: 10000, stawkaVat: 0.23 as const, opis: '',
    };
    const r = rozliczenieRoku(2026, [fv('2026-02', 20000)], [koszt], DEFAULT_SETTINGS, '2026-02-28');
    expect(r.miesiace[0].vat).toBe(0);
    expect(r.miesiace[0].vatNadwyzka).toBe(2300);
    expect(r.miesiace[1].vat).toBe(4600 - 2300);
  });
});
