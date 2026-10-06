import { describe, expect, it } from 'vitest';
import {
  audytPrzedWysylka,
  buildBackup,
  buildIcs,
  fakturaHtml,
  parseBackup,
} from './batchE.js';
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

describe('iCal', () => {
  it('generuje VCALENDAR z wydarzeniami całodniowymi', () => {
    const ics = buildIcs(
      [{ id: '2026-01-pit', data: '2026-01-20', tytul: 'PIT zaliczka — do 20.', opis: 'Mikrorachunek' }],
      2026,
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260120');
    expect(ics).toContain('PIT zaliczka');
    expect(ics).toContain('END:VCALENDAR');
  });
  it('escapuje średniki i przecinki', () => {
    const ics = buildIcs([{ id: 'x', data: '2026-02-01', tytul: 'A;B,C', opis: '' }], 2026);
    expect(ics).toContain('A\\;B\\,C');
  });
});

describe('backup 1-klik', () => {
  it('roundtrip: build → parse', () => {
    const data = { sales: [faktura()], costs: [], settings: DEFAULT_SETTINGS, contractors: [] };
    const parsed = parseBackup(buildBackup(data));
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].numer).toBe('1/01/2026');
    expect(parsed.settings.formaOpodatkowania).toBe(DEFAULT_SETTINGS.formaOpodatkowania);
  });
  it('odrzuca śmieci z polskim błędem', () => {
    expect(() => parseBackup('nie json')).toThrow();
    expect(() => parseBackup('{"app":"obcy","data":{}}')).toThrow('backup Franka');
    expect(() => parseBackup('{"app":"frank","data":{}}')).toThrow();
  });
});

describe('audyt przed wysyłką', () => {
  it('czysta faktura: same ok/warn, zero bladerów', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), status: 'w_ksef', ksefId: 'K1', zaplacona: true, bialaListaSprawdzona: '2026-01-20T10:00:00' }],
      settings: { ...DEFAULT_SETTINGS, firmaNazwa: 'Jan Kowalski', firmaNip: '1111111111', firmaAdres: 'Gdańsk', zusNrs: '123' },
      miesiac: '2026-01',
    });
    expect(items.filter((i) => i.status === 'blad')).toHaveLength(0);
  });
  it('wykrywa duplikat numeru', () => {
    const items = audytPrzedWysylka({
      sales: [faktura(), { ...faktura(), id: 'fv-2' }],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '1111111111' },
      miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'duplikaty')?.status).toBe('blad');
  });
  it('brutto >15k bez MPP i Białej Listy to blader', () => {
    const items = audytPrzedWysylka({
      sales: [faktura()],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '1111111111' },
      miesiac: '2026-01',
    });
    const bramka = items.find((i) => i.id === 'bramka-15k');
    expect(bramka?.status).toBe('blad');
    expect(bramka?.opis).toContain('ZAW-NR');
  });
  it('MPP gasi bramkę 15k', () => {
    const items = audytPrzedWysylka({
      sales: [{ ...faktura(), mpp: true }],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '1111111111' },
      miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'bramka-15k')?.status).toBe('ok');
  });
  it('pojazd 100% bez VAT-26 to blader', () => {
    const items = audytPrzedWysylka({
      sales: [],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '1111111111', uzytkowaniePojazdu: 'wylacznie_firma', vat26Zgloszony: false },
      miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'vat26')?.status).toBe('blad');
  });
  it('brak NIP firmy to blader', () => {
    const items = audytPrzedWysylka({
      sales: [],
      settings: { ...DEFAULT_SETTINGS, firmaNip: '' },
      miesiac: '2026-01',
    });
    expect(items.find((i) => i.id === 'nip-firmy')?.status).toBe('blad');
  });
});

describe('PDF faktury', () => {
  it('zawiera 11 pól art. 106e + MPP + rachunek', () => {
    const html = fakturaHtml(
      { ...faktura(), mpp: true, rachunekBankowy: 'PL 00', ksefId: 'KSEF-1' },
      { nazwa: 'Jan Kowalski', nip: '2222222222', adres: 'Gdańsk' },
    );
    for (const needle of [
      'Faktura VAT nr 1/01/2026', '31.01.2026', 'Jan Kowalski', 'Acme', '1111111111',
      'Usługi programistyczne', '24 600,00', 'Termin płatności', 'PL 00', 'podzielonej płatności', 'KSEF-1',
      'Słownie: dwadzieścia cztery tysiące sześćset złotych 00/100',
    ]) {
      expect(html).toContain(needle);
    }
  });
  it('adnotacje: odwrotne obciążenie, zwolnienie, VAT w PLN dla waluty', () => {
    const np = fakturaHtml({ ...faktura(), pozycje: [{ nazwa: 'dev', ilosc: 1, cenaNetto: 1000, stawkaVat: 'np' }] }, {});
    expect(np).toContain('Odwrotne obciążenie');
    const zw = fakturaHtml(faktura(), { vatowiec: false });
    expect(zw).toContain('art. 113 ust. 1');
    expect(zw).toContain('<h1>Faktura nr');
    const eur = fakturaHtml({ ...faktura(), waluta: 'EUR', kursNbp: 4.3 }, {});
    expect(eur).toContain('EUR');
    expect(eur).toContain('VAT <b>');
    expect(eur).toContain('euro');
  });
  it('escapuje HTML w nazwach', () => {
    const html = fakturaHtml(
      { ...faktura(), kontrahent: { id: 'k', nazwa: '<script>', nip: '', adres: '' } },
      {},
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
