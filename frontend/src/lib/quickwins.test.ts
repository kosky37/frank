// Batch F (szybkie wygrane) — testy czystych funkcji pomocniczych.
import { describe, expect, it } from 'vitest';
import {
  audytPrzedWysylka,
  fakturaHtml,
} from './batchE.js';
import { dzienPoprzedniRoboczy } from './nbp.js';
import {
  brakiArt106e,
  budujDowodBL,
  danePrzelewu,
  dniPoTerminie,
  kosztPracodawcy,
  kosztyCsv,
  marzaProcent,
  nalezneCykle,
  prognozaRoku,
  sprzedazCsv,
  terminyCsv,
  vatLimitProRata,
  zawNrDeadline,
} from './quickwins.js';
import { DEFAULT_SETTINGS } from '../../src-shared/tax/rates2026.js';
import type { SalesInvoice } from '../../src-shared/tax/types.js';

function faktura(patch: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 'fv-1',
    numer: '1/01/2026',
    kontrahent: { id: 'k', nazwa: 'Acme Sp. z o.o.', nip: '1111111111', adres: 'Warszawa' },
    dataWystawienia: '2026-01-31',
    dataSprzedazy: '2026-01-31',
    terminPlatnosci: '2026-02-14',
    pozycje: [{ nazwa: 'Usługi programistyczne', ilosc: 1, cenaNetto: 20000, stawkaVat: 0.23 }],
    status: 'wystawiona',
    ...patch,
  };
}

const SPRZEDAWCA = { nazwa: 'Jan Kowalski', nip: '2222222222', adres: 'Gdańsk' };

describe('dniPoTerminie', () => {
  it('liczy pełne doby opóźnienia', () => {
    expect(dniPoTerminie('2026-01-10', '2026-01-15')).toBe(5);
    expect(dniPoTerminie('2026-01-15', '2026-01-15')).toBe(0);
    expect(dniPoTerminie('2026-01-20', '2026-01-15')).toBe(0);
    expect(dniPoTerminie('zły-format', '2026-01-15')).toBe(0);
  });
});

describe('dzienPoprzedniRoboczy (NBP)', () => {
  it('cofa weekendy do piątku', () => {
    expect(dzienPoprzedniRoboczy('2026-01-05')).toBe('2026-01-02'); // pon → pt
    expect(dzienPoprzedniRoboczy('2026-01-04')).toBe('2026-01-02'); // nd → pt
    expect(dzienPoprzedniRoboczy('2026-01-07')).toBe('2026-01-06'); // śr → wt
  });
  it('przepuszcza zły format', () => {
    expect(dzienPoprzedniRoboczy('brak')).toBe('brak');
  });
});

describe('vatLimitProRata', () => {
  it('pełny rok: 240k (2026) / 200k (2025)', () => {
    const a = vatLimitProRata(100000, undefined, 2026);
    expect(a.limit).toBe(240000);
    expect(a.proRata).toBe(false);
    expect(a.uzycie).toBeCloseTo(100000 / 240000, 5);
    const b = vatLimitProRata(100000, undefined, 2025);
    expect(b.limit).toBe(200000);
  });
  it('starter 1 VII 2026: 240k/365*184 dni', () => {
    const r = vatLimitProRata(60000, '2026-07-01', 2026);
    expect(r.proRata).toBe(true);
    expect(r.dniAktywnosci).toBe(184);
    expect(r.limit).toBeCloseTo(120986.3, 1);
    expect(r.uzycie).toBeCloseTo(60000 / r.limit, 5);
  });
  it('start w innym roku nie rusza limitu', () => {
    const r = vatLimitProRata(100000, '2025-03-01', 2026);
    expect(r.proRata).toBe(false);
    expect(r.limit).toBe(240000);
  });
});

describe('prognozaRoku / marzaProcent', () => {
  it('ekstrapolacja liniowa YTD na 12 mies.', () => {
    expect(prognozaRoku(60000, 3)).toBe(240000);
    expect(prognozaRoku(240000, 12)).toBe(240000);
    expect(prognozaRoku(1000, 0)).toBe(0);
  });
  it('marża w % przychodu', () => {
    expect(marzaProcent(50000, 200000)).toBe(25);
    expect(marzaProcent(100, 0)).toBe(0);
  });
});

describe('terminyCsv', () => {
  it('nagłówek + wiersze, cudzysłów przy średniku', () => {
    const csv = terminyCsv([{ id: 'a', data: '2026-01-20', tytul: 'PIT; zaliczka', opis: 'x' }]);
    expect(csv.startsWith('id;data;tytul;opis\n')).toBe(true);
    expect(csv).toContain('"PIT; zaliczka"');
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('sprzedazCsv / kosztyCsv', () => {
  it('faktury: nagłówek + rodzaj', () => {
    const csv = sprzedazCsv([faktura({ rodzaj: 'proforma' as const })]);
    expect(csv.startsWith('numer;kontrahent;nip;dataSprzedazy;netto;status;rodzaj\n')).toBe(true);
    expect(csv).toContain('proforma');
  });
  it('koszty: format zgodny z importem', async () => {
    const { parseCostsCsv } = await import('../components/Costs.js');
    const csv = kosztyCsv([{
      id: 'c1', numer: 'FV/1', wystawca: 'Orlen', dataZakupu: '2026-01-05',
      dataKsiegowania: '2026-01-05', kategoria: 'paliwo' as const, pojazdowy: false,
      uzytkowaniePojazdu: 'mieszany' as const, netto: 500, stawkaVat: 0.23 as const, opis: 'x',
    }]);
    const rows = parseCostsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].netto).toBe(500);
    expect(rows[0].kategoria).toBe('paliwo');
  });
});

describe('brakiArt106e (11 pól)', () => {
  it('kompletna faktura: zero braków', () => {
    expect(brakiArt106e(faktura(), SPRZEDAWCA)).toEqual([]);
  });
  it('wykrywa braki: NIP-y, adres, pozycje, termin', () => {
    const braki = brakiArt106e(
      faktura({
        numer: ' ',
        kontrahent: { id: 'k', nazwa: '', nip: '', adres: '' },
        pozycje: [],
        terminPlatnosci: '',
      }),
      {},
    );
    for (const needle of ['numer faktury', 'nazwa sprzedawcy', 'NIP sprzedawcy', 'adres sprzedawcy', 'nazwa nabywcy', 'pozycje (nazwa/ilość/cena)', 'wartość netto > 0', 'termin płatności', 'NIP nabywcy (poza paragonem)']) {
      expect(braki).toContain(needle);
    }
  });
});

describe('audyt: art106e', () => {
  it('komplet: ok', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), status: 'w_ksef', mpp: true }],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '1111111111', firmaNazwa: 'JK', firmaAdres: 'Gdańsk', zusNrs: '1' },
      miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'art106e')?.status).toBe('ok');
  });
  it('brak NIP firmy: blad z opisem pola', () => {
    const items = audytPrzedWysylka({
      sales: [faktura()],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '' },
      miesiac: '2026-01',
    });
    const art = items.find((i) => i.id === 'art106e');
    expect(art?.status).toBe('blad');
    expect(art?.opis).toContain('NIP sprzedawcy');
  });
});

describe('fakturaHtml: logo + dark-mode', () => {
  it('logo w nagłówku gdy podane', () => {
    const html = fakturaHtml(faktura(), { ...SPRZEDAWCA, logoUrl: 'https://x/logo.png' });
    expect(html).toContain('<img src="https://x/logo.png"');
    expect(html).toContain('background:#fff');
  });
  it('dark-mode: ciemne tło, brak logo bez URL', () => {
    const html = fakturaHtml(faktura(), SPRZEDAWCA, { motyw: 'ciemny' });
    expect(html).toContain('background:#111');
    expect(html).not.toContain('<img');
  });
});

describe('Batch G: dowody BL, ZAW-NR, przelew, etat, cykle', () => {
  it('budujDowodBL: ID + timestamp + NIP cyframi', () => {
    const d = budujDowodBL('525-000-00-00', '1/01/2026', 24600, 'PL 00', 'biala-lista');
    expect(d.id.startsWith('BL-')).toBe(true);
    expect(d.nipKontrahenta).toBe('5250000000');
    expect(d.kanal).toBe('biala-lista');
  });
  it('zawNrDeadline: +7 dni', () => {
    expect(zawNrDeadline('2026-01-10')).toBe('2026-01-17');
    expect(zawNrDeadline('złe')).toBe('');
  });
  it('danePrzelewu: 4 linie do wklejenia w banku', () => {
    const t = danePrzelewu('PL 00', 24600, 'FV 1/2026', 'Acme');
    expect(t).toContain('Rachunek: PL 00');
    expect(t).toContain('24600.00 PLN');
  });
  it('kosztPracodawcy: ~20,48% brutto', () => {
    const k = kosztPracodawcy(10000);
    expect(k.zusPracodawcy).toBe(2048);
    expect(k.kosztCalkowity).toBe(12048);
  });
  it('nalezneCykle: od następnego po ostatnim do bieżącego', () => {
    const cykle = [{ id: 'c1', szablonNumer: '1/01/2026', dzienMiesiaca: 5, aktywna: true, ostatniWygenerowany: '2026-01' }];
    const due = nalezneCykle(cykle, '2026-03');
    expect(due.map((d) => d.miesiac)).toEqual(['2026-02', '2026-03']);
    expect(nalezneCykle([{ ...cykle[0], aktywna: false }], '2026-03')).toEqual([]);
  });
});

describe('audyt: rodzaje faktur', () => {
  const settings = { ...DEFAULT_SETTINGS, firmaNip: '1111111111', firmaNazwa: 'JK', firmaAdres: 'Gdańsk', zusNrs: '1' };
  it('korekta bez odwołania: warn', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), rodzaj: 'korygujaca' as const, status: 'w_ksef', mpp: true }],
      settings, miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'rodzaje-faktur')?.status).toBe('warn');
  });
  it('zał. 15 powyżej 15k bez MPP: blad', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), zal15: true, status: 'w_ksef' }],
      settings, miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'rodzaje-faktur')?.status).toBe('blad');
  });
  it('uproszczona powyżej 450 zł: warn', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), rodzaj: 'uproszczona' as const, status: 'w_ksef', mpp: true }],
      settings, miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'rodzaje-faktur')?.status).toBe('warn');
  });
});
