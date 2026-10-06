import { describe, expect, it } from 'vitest';
import {
  buildJpkEwp, buildJpkPkpir, buildJpkSt, buildJpkV7K, buildJpkV7M, buildKsefFA3,
  buildPitRocznyXmlFull, czyNipPoprawny, mikrorachunek, walidujJpkV7,
} from './integrations.js';
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

describe('JPK_V7K', () => {
  it('kwartał: nagłówek Q1, ewidencja z 3 miesięcy, deklaracja', () => {
    const qs: MonthlySums = { ...sums, miesiac: '2026-Q1', vatNalezny: 13800, vatNaliczony: 1380 };
    const r = buildJpkV7K('2026-Q1', [sale], [], qs, { nip: '1111111111', nazwa: 'Jan Kowalski' });
    expect(r.ok).toBe(true);
    for (const tag of ['JPK_V7K', '<Kwartal>1</Kwartal>', '<Ewidencja>', '<SprzedazWiersz>', '<Deklaracja>', '<P_51>12420.00</P_51>']) {
      expect(r.payload).toContain(tag);
    }
    expect(r.payload).toContain('DataZakresuOd>2026-01-01');
  });
  it('filtruje dokumenty spoza kwartału', () => {
    const obca: SalesInvoice = { ...sale, id: 't2', dataSprzedazy: '2026-04-15', dataWystawienia: '2026-04-15' };
    const qs: MonthlySums = { ...sums, miesiac: '2026-Q1' };
    const r = buildJpkV7K('2026-Q1', [sale, obca], [], qs);
    expect(r.payload).toContain('<LiczbaWierszySprzedazy>1</LiczbaWierszySprzedazy>');
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

describe('Batch G: walidacja JPK, PKPIR/EWP/ST, PIT full', () => {
  it('walidujJpkV7: dobry XML przechodzi, zły zgłasza braki', () => {
    const dobry = buildJpkV7M('2026-01', [sale], [], sums, { nip: '1111111111', nazwa: 'JK' }).payload;
    expect(walidujJpkV7(dobry).ok).toBe(true);
    const zly = walidujJpkV7('<JPK><Naglowek/></JPK>');
    expect(zly.ok).toBe(false);
    expect(zly.bledy.length).toBeGreaterThan(0);
  });
  it('walidujJpkV7: licznik niezgodny z wierszami', () => {
    const dobry = buildJpkV7M('2026-01', [sale], [], sums, { nip: '1111111111' }).payload;
    const popsuty = dobry.replace('<LiczbaWierszySprzedazy>1</LiczbaWierszySprzedazy>', '<LiczbaWierszySprzedazy>9</LiczbaWierszySprzedazy>');
    const w = walidujJpkV7(popsuty);
    expect(w.ok).toBe(false);
    expect(w.bledy.join(' ')).toContain('SprzedazCtrl');
  });
  it('JPK_PKPIR: wiersze miesięczne + sumy', () => {
    const r = buildJpkPkpir('2026', [sums], { nip: '1111111111', nazwa: 'JK' });
    expect(r.ok).toBe(true);
    for (const tag of ['JPK_PKPIR', '<PKPIRWiersz>', '<SumaPrzychodow>20000.00</SumaPrzychodow>', '<LiczbaWierszy>1</LiczbaWierszy>']) {
      expect(r.payload).toContain(tag);
    }
  });
  it('JPK_EWP: rozbicie na stawki ryczałtu', () => {
    const s = { ...sums, ryczaltSplit: [{ stawka: 0.12, przychod: 20000 }] };
    const r = buildJpkEwp('2026', [s], { nip: '1111111111' });
    expect(r.payload).toContain('JPK_EWP');
    expect(r.payload).toContain('wartosc="0.12"');
  });
  it('JPK_ST: środki z umorzeniem', () => {
    const r = buildJpkSt([{ nazwa: 'Laptop', wartosc: 12000, umorzenie: 2000 }], { nip: '1111111111' });
    expect(r.payload).toContain('JPK_ST');
    expect(r.payload).toContain('<WartoscNetto>10000.00</WartoscNetto>');
  });
  it('PIT full: PIT/B + PIT/O + danina', () => {
    const r = buildPitRocznyXmlFull('PIT-36L', '2026', {
      przychod: 240000, koszty: 24000, podatek: 30000, danina: 0,
      pitB: [{ opis: 'Usługi programistyczne', przychod: 240000, koszty: 24000 }],
      ulgi: [{ kod: 'IP-BOX', kwota: 50000 }],
    });
    expect(r.ok).toBe(true);
    for (const tag of ['formularz="PIT-36L"', '<ZalacznikB>', '<ZalacznikO>', 'IP-BOX', '<DaninaSolidarnosciowa>0.00</DaninaSolidarnosciowa>']) {
      expect(r.payload).toContain(tag);
    }
  });
  it('KSeF FA(3): tryb + zał. 15 + korekta w adnotacjach', () => {
    const r = buildKsefFA3({ ...sale, rodzaj: 'korygujaca', korygujeNumer: '1/01/2026', zal15: true, trybKsef: 'offline24' }, '1111111111');
    const j = JSON.parse(r.payload) as { tryb: string; adnotacje: { zalacznik15: boolean; korekta: boolean; korygujeNumer: string } };
    expect(j.tryb).toBe('offline24');
    expect(j.adnotacje.zalacznik15).toBe(true);
    expect(j.adnotacje.korekta).toBe(true);
    expect(j.adnotacje.korygujeNumer).toBe('1/01/2026');
  });
});
