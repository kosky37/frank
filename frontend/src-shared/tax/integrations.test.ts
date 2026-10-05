import { describe, expect, it } from 'vitest';
import { buildJpkV7M, buildKsefFA3, czyNipPoprawny, mikrorachunek } from './integrations.js';
import type { MonthlySums, SalesInvoice } from './types.js';

const sale: SalesInvoice = {
  id: 't1',
  numer: '1/01/2026',
  kontrahent: { id: 'k', nazwa: 'Acme Sp. z o.o.', nip: '5250000000', adres: 'Warszawa' },
  dataWystawienia: '2026-01-31',
  dataSprzedazy: '2026-01-31',
  terminPlatnosci: '2026-02-14',
  pozycje: [{ nazwa: 'Usługi programistyczne 01/2026', ilosc: 1, cenaNetto: 20000, stawkaVat: 0.23 }],
  status: 'wystawiona',
  mpp: true,
};

const sums: MonthlySums = {
  miesiac: '2026-01',
  przychodNetto: 20000,
  kosztyNettoPit: 6000,
  vatNalezny: 4600,
  vatNaliczony: 1380,
  zusSpoleczne: 1788.29,
  zusZdrowotna: 432.54,
  ryczaltSplit: [],
};

describe('JPK_V7M', () => {
  it('zawiera JPK_V7M, wiersze, kontrolki i sumy', () => {
    const r = buildJpkV7M('2026-01', [sale], [], sums, { nip: '1111111111', nazwa: 'Jan Kowalski' });
    expect(r.ok).toBe(true);
    for (const tag of ['JPK_V7M', '<Naglowek>', '<Podmiot1', '<Ewidencja>', '<SprzedazWiersz>', '<Deklaracja>', 'Jan Kowalski']) {
      expect(r.payload).toContain(tag);
    }
    expect(r.payload).toContain('4600.00'); // P_38 / PodatekNalezny
    expect(r.payload).toContain('1380.00'); // P_39 / PodatekNaliczony
    expect(r.payload).toContain('<LiczbaWierszySprzedazy>1</LiczbaWierszySprzedazy>');
  });
});

describe('KSeF FA(3)', () => {
  it('parsuje się i zawiera NIP sprzedawcy, pozycje i MPP', () => {
    const r = buildKsefFA3(sale, '1111111111');
    const j = JSON.parse(r.payload) as {
      podmiot1: { nip: string };
      pozycje: unknown[];
      podsumowanie: { razemBrutto: number };
      adnotacje: { mpp: boolean };
    };
    expect(j.podmiot1.nip).toBe('1111111111');
    expect(j.pozycje).toHaveLength(1);
    expect(j.podsumowanie.razemBrutto).toBe(24600);
    expect(j.adnotacje.mpp).toBe(true);
  });
});

describe('mikrorachunek', () => {
  it('format PL + 26 cyfr i suma kontrolna mod97', () => {
    const r = mikrorachunek('1111111111');
    expect(r).toMatch(/^PL\d{2}(\s?\d{4}){6}$/);
    const raw = r.replace(/\s/g, '');
    expect(raw).toHaveLength(28);
    // Weryfikacja ISO 13616: przestawiony numer mod 97 == 1.
    const przestawiony = raw.slice(4) + raw.slice(0, 4);
    const num = przestawiony.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    let rest = 0;
    for (const ch of num) rest = (rest * 10 + Number(ch)) % 97;
    expect(rest).toBe(1);
    expect(mikrorachunek('2222222222')).not.toBe(r);
  });
  it('NIP: poprawny vs błędny (wagi MF)', () => {
    expect(czyNipPoprawny('1111111111')).toBe(true);
    expect(czyNipPoprawny('1111111112')).toBe(false);
    expect(() => mikrorachunek('123')).toThrow();
  });
});
