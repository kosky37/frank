import { describe, expect, it } from 'vitest';
import { czyDzienWolny, dzienRoboczy, przesunNaRoboczy, swietaPL, terminyRoku, wielkanoc } from './terminy.js';
import { okresPrzelewu, przelewZobowiazania, symbolFormularza } from './rozliczenie.js';
import { zakresDoDnia } from './nbp.js';
import { brakiArt106e } from './quickwins.js';
import { mailtoFaktury, przesunOkresWNazwie, szablonKorekty } from '../components/Sales.js';
import { DEFAULT_SETTINGS } from '../../src-shared/tax/rates2026.js';
import type { SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('święta i dni robocze', () => {
  it('wyznacza Wielkanoc', () => {
    expect(iso(wielkanoc(2026))).toBe('2026-04-05');
    expect(iso(wielkanoc(2027))).toBe('2027-03-28');
    expect(iso(wielkanoc(2025))).toBe('2025-04-20');
  });
  it('zawiera święta ruchome i Wigilię od 2025', () => {
    const s = swietaPL(2026);
    expect(s.has('2026-04-06')).toBe(true); // Poniedziałek Wielkanocny
    expect(s.has('2026-05-24')).toBe(true); // Zielone Świątki
    expect(s.has('2026-06-04')).toBe(true); // Boże Ciało
    expect(s.has('2026-12-24')).toBe(true);
    expect(swietaPL(2024).has('2024-12-24')).toBe(false);
  });
  it('przesuwa termin na następny dzień roboczy (art. 12 § 5 OP)', () => {
    expect(dzienRoboczy(2026, 12, 25)).toBe('2026-12-28'); // pt święto → pn
    expect(przesunNaRoboczy('2026-01-06')).toBe('2026-01-07'); // wt Trzech Króli
    expect(przesunNaRoboczy('2026-11-11')).toBe('2026-11-12');
    expect(przesunNaRoboczy('2026-03-20')).toBe('2026-03-20'); // zwykły piątek
    expect(czyDzienWolny('2026-08-15')).toBe(true);
  });
  it('dzienRoboczy obcina dzień do końca miesiąca', () => {
    expect(dzienRoboczy(2026, 2, 31)).toBe('2026-03-02'); // 28.02 to sobota
  });
});

describe('terminyRoku', () => {
  it('miesięcznie: 12 terminów PIT i VAT dla vatowca', () => {
    const t = terminyRoku(2026, { zaliczkaPit: 'miesieczna', okresVat: 'miesieczny', vatowiec: true });
    expect(t.filter((x) => x.rodzaj === 'pit')).toHaveLength(12);
    expect(t.filter((x) => x.rodzaj === 'vat')).toHaveLength(12);
  });
  it('kwartalnie: PIT i deklaracja VAT po kwartale; JPK_V7K co miesiąc jako sama ewidencja; bez VAT dla zwolnionego', () => {
    const t = terminyRoku(2026, { zaliczkaPit: 'kwartalna', okresVat: 'kwartalny', vatowiec: true });
    const mies = (f: (x: (typeof t)[number]) => boolean): string[] => t.filter(f).map((x) => x.data.slice(5, 7));
    expect(new Set(mies((x) => x.rodzaj === 'pit'))).toEqual(new Set(['01', '04', '07', '10']));
    expect(new Set(mies((x) => x.rodzaj === 'vat' && x.tytul.includes('+ VAT')))).toEqual(new Set(['01', '04', '07', '10']));
    expect(t.filter((x) => x.rodzaj === 'vat')).toHaveLength(12);
    const zw = terminyRoku(2026, { zaliczkaPit: 'miesieczna', okresVat: 'miesieczny', vatowiec: false });
    expect(zw.some((x) => x.rodzaj === 'vat')).toBe(false);
  });
  it('terminy płatności i deklaracji wypadają w dni robocze', () => {
    const terminy = terminyRoku(2026).filter((t) => t.rodzaj !== 'info' && !t.id.endsWith('epit-start'));
    for (const t of terminy) expect(czyDzienWolny(t.data), `${t.id} ${t.data}`).toBe(false);
  });
});

describe('przelewy na mikrorachunek / NRS', () => {
  const settings: TaxpayerSettings = {
    ...DEFAULT_SETTINGS,
    firmaNip: '5260250274',
    formaOpodatkowania: 'liniowy',
    zusNrs: '12 6000 0002 0260 1234 5678 9012',
  };
  it('formatuje okres i symbol formularza', () => {
    expect(okresPrzelewu('2026-09')).toBe('26M09');
    expect(okresPrzelewu('2026-Q3')).toBe('26K03');
    expect(symbolFormularza('pit', settings)).toBe('PIT-36L');
    expect(symbolFormularza('pit', { ...settings, formaOpodatkowania: 'ryczalt' })).toBe('PIT-28');
    expect(symbolFormularza('vat', { ...settings, okresVat: 'kwartalny' })).toBe('VAT-7K');
  });
  it('PIT: tytuł wg rozporządzenia, rachunek = mikrorachunek z NIP', () => {
    const p = przelewZobowiazania({ id: 'x', rodzaj: 'pit', tytul: '', okres: '2026-09', termin: '2026-10-20', kwota: 1234.5 }, settings);
    expect(p?.tytul).toBe('N5260250274 26M09 PIT-36L');
    expect(p?.rachunek.replace(/\s/g, '')).toMatch(/^PL\d{26}$/);
    expect(p?.rachunek.replace(/\s/g, '')).toContain('1010007122225260250274');
  });
  it('ZUS: rachunek NRS bez spacji; brak NRS albo NIP → null', () => {
    const z = przelewZobowiazania({ id: 'z', rodzaj: 'zus', tytul: '', okres: '2026-09', termin: '2026-10-20', kwota: 2000 }, settings);
    expect(z?.rachunek).toBe('12600000020260123456789012');
    expect(przelewZobowiazania({ id: 'z', rodzaj: 'zus', tytul: '', okres: '2026-09', termin: '', kwota: 1 }, { ...settings, zusNrs: '' })).toBeNull();
    expect(przelewZobowiazania({ id: 'p', rodzaj: 'vat', tytul: '', okres: '2026-09', termin: '', kwota: 1 }, { ...settings, firmaNip: '123' })).toBeNull();
  });
});

describe('NBP — zakres dla dnia bez tabeli', () => {
  it('10 dni wstecz, do dnia włącznie', () => {
    expect(zakresDoDnia('2026-01-06')).toEqual(['2025-12-27', '2026-01-06']);
  });
});

function faktura(patch: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 'fv-1',
    numer: '3/09/2026',
    kontrahent: { id: 'k', nazwa: 'Acme Sp. z o.o.', nip: '1111111111', adres: 'Warszawa', email: 'ksiegowosc@acme.pl' },
    dataWystawienia: '2026-09-30',
    dataSprzedazy: '2026-09-30',
    terminPlatnosci: '2026-10-14',
    pozycje: [{ nazwa: 'Usługi programistyczne 09/2026', ilosc: 1, cenaNetto: 20000, stawkaVat: 0.23 }],
    status: 'w_ksef',
    ksefId: '5260250274-20260930-ABCDEF123456-AB',
    zaplacona: true,
    ...patch,
  };
}
const SPRZEDAWCA = { nazwa: 'Jan Kowalski', nip: '5260250274', adres: 'Gdańsk' };

describe('faktura korygująca', () => {
  it('szablon storno: ujemne ilości, numer korygowanej, czyste pola KSeF/płatności', () => {
    const k = szablonKorekty(faktura(), '2026-10-05');
    expect(k.rodzaj).toBe('korygujaca');
    expect(k.korygujeNumer).toBe('3/09/2026');
    expect(k.dataWystawienia).toBe('2026-10-05');
    expect(k.dataSprzedazy).toBe('2026-09-30');
    expect(k.pozycje?.[0].ilosc).toBe(-1);
    expect(k.ksefId).toBeUndefined();
    expect(k.zaplacona).toBe(false);
    expect(k.status).toBe('robocza');
    expect(k.id).toBeUndefined();
  });
  it('brakiArt106e akceptuje korektę z ujemną kwotą, ale wymaga numeru korygowanej i wartości ≠ 0', () => {
    const k = { ...faktura(), ...szablonKorekty(faktura(), '2026-10-05'), id: 'k1', numer: 'KOR/1/10/2026' } as SalesInvoice;
    expect(brakiArt106e(k, SPRZEDAWCA)).toEqual([]);
    expect(brakiArt106e({ ...k, korygujeNumer: '' }, SPRZEDAWCA)).toContain('numer faktury korygowanej');
    expect(brakiArt106e({ ...k, pozycje: [{ ...k.pozycje[0], ilosc: 0 }] }, SPRZEDAWCA).length).toBeGreaterThan(0);
    // zwykła faktura z ujemną ilością nadal jest błędna
    expect(brakiArt106e(faktura({ pozycje: [{ nazwa: 'x', ilosc: -1, cenaNetto: 10, stawkaVat: 0.23 }] }), SPRZEDAWCA).length).toBeGreaterThan(0);
  });
});

describe('pomocnicze faktur', () => {
  it('przesuwa MM/RRRR w nazwie pozycji przy kopiowaniu', () => {
    expect(przesunOkresWNazwie('Usługi 09/2026', '2026-09-30', '2026-10-31')).toBe('Usługi 10/2026');
    expect(przesunOkresWNazwie('Usługi', '2026-09-30', '2026-10-31')).toBe('Usługi');
  });
  it('mailto: adres nabywcy, numer i kwota brutto, numer KSeF, rachunek z ustawień', () => {
    const s: TaxpayerSettings = { ...DEFAULT_SETTINGS, firmaNazwa: 'Kowalski IT', firmaRachunek: '11 1111 1111 1111 1111 1111 1111' };
    const url = mailtoFaktury(faktura(), s);
    expect(url.startsWith('mailto:ksiegowosc%40acme.pl?subject=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(decodeURIComponent(url.split('subject=')[1].split('&')[0])).toBe('Faktura 3/09/2026 — Kowalski IT');
    expect(body).toContain('nr 3/09/2026');
    expect(body).toMatch(/24\s?600,00/);
    expect(body).toContain('Numer KSeF: 5260250274-20260930-ABCDEF123456-AB');
    expect(body).toContain('Rachunek: 11 1111 1111 1111 1111 1111 1111');
    expect(body).not.toMatch(/\n\n\n/);
  });
});
