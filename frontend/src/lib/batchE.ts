// Batch E — logika „polerowania": iCal, backup, audyt przed wysyłką, PDF faktury.
// Czyste funkcje (bez DOM), testowane w batchE.test.ts.

import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { brakKursu, salesVat, salesVatPln } from '../../src-shared/tax/vat.js';
import { czyNipPoprawny } from '../../src-shared/tax/integrations.js';
import { brakiArt106e } from './quickwins.js';
import { kwotaSlownie } from './slownie.js';

// --- iCal ---

export interface TerminIcs {
  id: string;
  data: string; // yyyy-mm-dd
  tytul: string;
  opis: string;
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** VCALENDAR z terminami (wydarzenia całodniowe, data w formacie YYYYMMDD). */
export function buildIcs(terminy: TerminIcs[], rok: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events = terminy
    .map((t) => {
      const dt = t.data.replaceAll('-', '');
      return (
        `BEGIN:VEVENT\r\nUID:${t.id}@frank-jdg\r\nDTSTAMP:${stamp}\r\n` +
        `DTSTART;VALUE=DATE:${dt}\r\nSUMMARY:${icsEscape(t.tytul)}\r\n` +
        `DESCRIPTION:${icsEscape(t.opis)}\r\nEND:VEVENT`
      );
    })
    .join('\r\n');
  return (
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Frank-JDG//Terminy ${rok}//PL\r\n` +
    `CALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR\r\n`
  );
}

// --- Backup 1-klik ---

export interface BackupData {
  sales: SalesInvoice[];
  costs: CostInvoice[];
  settings: TaxpayerSettings;
  contractors: unknown[];
}

export interface BackupPayload {
  app: 'frank';
  version: 1;
  exportedAt: string;
  data: BackupData;
}

/** Serializacja pełnego stanu do JSON (eksport 1-klik). */
export function buildBackup(data: BackupData): string {
  const payload: BackupPayload = {
    app: 'frank',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(payload, null, 2);
}

const FORMY = new Set(['skala', 'liniowy', 'ryczalt']);

/** Parsowanie + walidacja backupu. Rzuca Error z polskim komunikatem. */
export function parseBackup(text: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('To nie jest poprawny plik JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('Backup ma zły format (brak obiektu).');
  const p = raw as Record<string, unknown>;
  if (p['app'] !== 'frank') throw new Error('To nie jest backup Franka (pole app).');
  const data = p['data'] as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') throw new Error('Backup nie zawiera danych (pole data).');
  if (!Array.isArray(data['sales']) || !Array.isArray(data['costs'])) {
    throw new Error('Backup nie zawiera faktur ani kosztów.');
  }
  const settings = data['settings'] as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== 'object' || !FORMY.has(String(settings['formaOpodatkowania']))) {
    throw new Error('Backup ma uszkodzone ustawienia (forma opodatkowania).');
  }
  return {
    sales: data['sales'] as SalesInvoice[],
    costs: data['costs'] as CostInvoice[],
    settings: settings as unknown as TaxpayerSettings,
    contractors: Array.isArray(data['contractors']) ? (data['contractors'] as unknown[]) : [],
  };
}

// --- Audyt przed wysyłką ---

export type AudytStatus = 'ok' | 'warn' | 'blad';

export interface AudytItem {
  id: string;
  tytul: string;
  status: AudytStatus;
  opis: string;
}

/**
 * Checklista „audyt przed wysyłką" dla miesiąca (JPK/KSeF/DRA).
 * Kolejność: blokery (blad) najpierw mają sens przy sortowaniu w UI.
 */
export function audytPrzedWysylka(args: {
  sales: SalesInvoice[];
  settings: TaxpayerSettings;
  miesiac: string; // yyyy-mm
}): AudytItem[] {
  const { sales, settings, miesiac } = args;
  const out: AudytItem[] = [];
  const fakturyM = sales.filter((s) => s.dataSprzedazy.startsWith(miesiac) && s.status !== 'robocza');

  // 1. NIP firmy
  const nipFirmy = (settings.firmaNip ?? '').trim();
  out.push(
    nipFirmy && czyNipPoprawny(nipFirmy)
      ? { id: 'nip-firmy', tytul: 'NIP firmy', status: 'ok', opis: `NIP ${nipFirmy} poprawny (JPK/KSeF/DRA).` }
      : {
          id: 'nip-firmy',
          tytul: 'NIP firmy',
          status: 'blad',
          opis: 'Brak lub błędny NIP firmy (Ustawienia) — JPK, KSeF i DRA wymagają poprawnego NIP.',
        },
  );

  // 2. Duplikaty numerów (globalnie — numeracja ma być unikalna)
  const widziane = new Map<string, number>();
  for (const s of sales) widziane.set(s.numer.trim(), (widziane.get(s.numer.trim()) ?? 0) + 1);
  const duplikaty = [...widziane.entries()].filter(([, n]) => n > 1).map(([numer]) => numer);
  out.push(
    duplikaty.length === 0
      ? { id: 'duplikaty', tytul: 'Numeracja bez duplikatów', status: 'ok', opis: 'Każdy numer faktury występuje raz.' }
      : {
          id: 'duplikaty',
          tytul: 'Numeracja bez duplikatów',
          status: 'blad',
          opis: `Powtórzone numery: ${duplikaty.join(', ')} — popraw przed wysyłką do KSeF.`,
        },
  );

  // 3. Poprawność pozycji w miesiącu
  const zlePozycje = fakturyM.filter(
    (s) => s.pozycje.length === 0 || s.pozycje.some((p) => !p.nazwa.trim() || p.ilosc <= 0 || p.cenaNetto < 0),
  );
  out.push(
    zlePozycje.length === 0
      ? { id: 'pozycje', tytul: 'Pozycje faktur', status: 'ok', opis: `${fakturyM.length} faktur w miesiącu, pozycje kompletne.` }
      : {
          id: 'pozycje',
          tytul: 'Pozycje faktur',
          status: 'blad',
          opis: `${zlePozycje.length} faktur ma puste/błędne pozycje: ${zlePozycje.map((s) => s.numer).join(', ')}.`,
        },
  );

  // 4. NIP-y nabywców
  const zleNipy = fakturyM.filter((s) => s.kontrahent.nip && !czyNipPoprawny(s.kontrahent.nip));
  const bezNipu = fakturyM.filter((s) => !s.kontrahent.nip.trim());
  out.push({
    id: 'nipy-nabywcow',
    tytul: 'NIP-y nabywców',
    status: zleNipy.length > 0 ? 'blad' : bezNipu.length > 0 ? 'warn' : 'ok',
    opis:
      zleNipy.length > 0
        ? `Błędne NIP-y: ${zleNipy.map((s) => `${s.numer} (${s.kontrahent.nip})`).join(', ')}.`
        : bezNipu.length > 0
          ? `Bez NIP: ${bezNipu.map((s) => s.numer).join(', ')} — paragon/faktura uproszczona OK, inaczej uzupełnij.`
          : 'Wszystkie NIP-y nabywców poprawne.',
  });

  // 4b. Walidator 11 pól art. 106e (braki per faktura miesiąca)
  const sprzedawca106e = { nazwa: settings.firmaNazwa, nip: settings.firmaNip, adres: settings.firmaAdres };
  const zBrakami = fakturyM
    .map((s) => ({ numer: s.numer, braki: brakiArt106e(s, sprzedawca106e) }))
    .filter((x) => x.braki.length > 0);
  out.push(
    zBrakami.length === 0
      ? { id: 'art106e', tytul: 'Kompletność wg art. 106e', status: 'ok', opis: 'Wszystkie faktury miesiąca mają komplet 11 pól obowiązkowych.' }
      : {
        id: 'art106e',
        tytul: 'Kompletność wg art. 106e',
        status: 'blad',
        opis: zBrakami.slice(0, 3).map((x) => `${x.numer}: brak ${x.braki.join(', ')}`).join(' • ') +
          (zBrakami.length > 3 ? ` (+${zBrakami.length - 3} kolejnych)` : ''),
      },
  );

  // 5. Bramka >15k: Biała Lista lub MPP
  const duzeBez = fakturyM.filter((s) => {
    const brutto = salesVat(s).brutto;
    return brutto > 15000 && !s.mpp && !s.bialaListaSprawdzona;
  });
  const duzeMpp = fakturyM.filter((s) => salesVat(s).brutto > 15000 && s.mpp);
  out.push(
    duzeBez.length === 0
      ? {
          id: 'bramka-15k',
          tytul: 'Bramka 15 000 zł',
          status: 'ok',
          opis:
            duzeMpp.length > 0
              ? `${duzeMpp.length} faktur powyżej 15 tys. z MPP — sprawdzenie Białej Listy nie jest wymagane.`
              : 'Brak faktur powyżej 15 tys. albo wszystkie mają MPP / potwierdzenie Białej Listy.',
        }
      : {
          id: 'bramka-15k',
          tytul: 'Bramka 15 000 zł',
          status: 'blad',
          opis: `${duzeBez.map((s) => s.numer).join(', ')} — brutto >15 tys. bez MPP i bez sprawdzenia Białej Listy. Grozi solidarna odpowiedzialność VAT (escape: MPP albo ZAW-NR w 7 dni).`,
        },
  );

  // 5b. Rodzaje faktur: korekta z odwołaniem, zał. 15 → MPP, uproszczona ≤450 zł
  const korektyBezOdniesienia = fakturyM.filter((s) => s.rodzaj === 'korygujaca' && !s.korygujeNumer?.trim());
  const zal15BezMpp = fakturyM.filter((s) => s.zal15 === true && salesVat(s).brutto > 15000 && !s.mpp);
  const uproszczoneDuze = fakturyM.filter((s) => s.rodzaj === 'uproszczona' && salesVat(s).brutto > 450);
  const problemyRodzajow: string[] = [
    ...korektyBezOdniesienia.map((s) => `${s.numer}: korekta bez numeru korygowanej`),
    ...zal15BezMpp.map((s) => `${s.numer}: zał. 15 i brutto >15 tys. bez MPP`),
    ...uproszczoneDuze.map((s) => `${s.numer}: uproszczona powyżej 450 zł`),
  ];
  out.push({
    id: 'rodzaje-faktur',
    tytul: 'Rodzaje faktur (korekta/zał. 15/uproszczona)',
    status: zal15BezMpp.length > 0 ? 'blad' : problemyRodzajow.length > 0 ? 'warn' : 'ok',
    opis: problemyRodzajow.length > 0
      ? problemyRodzajow.slice(0, 3).join(' • ') + (problemyRodzajow.length > 3 ? ` (+${problemyRodzajow.length - 3} kolejnych)` : '')
      : 'Korekty mają odwołania, zał. 15 z MPP, uproszczone do 450 zł.',
  });

  // 5c. Faktury walutowe bez kursu NBP — PIT/VAT/JPK w PLN byłyby błędne
  const bezKursu = fakturyM.filter(brakKursu);
  out.push(
    bezKursu.length === 0
      ? { id: 'kurs-nbp', tytul: 'Kursy NBP faktur walutowych', status: 'ok', opis: 'Faktury walutowe mają kurs NBP (albo brak faktur walutowych).' }
      : {
          id: 'kurs-nbp',
          tytul: 'Kursy NBP faktur walutowych',
          status: 'blad',
          opis: `${bezKursu.map((s) => `${s.numer} (${s.waluta})`).join(', ')} — brak kursu NBP; kwoty liczone 1:1 jak w PLN. Uzupełnij kurs w fakturze.`,
        },
  );

  // 6. VAT-26 przy pojeździe 100%
  out.push(
    settings.uzytkowaniePojazdu === 'wylacznie_firma' && !settings.vat26Zgloszony
      ? {
          id: 'vat26',
          tytul: 'VAT-26 (pojazd 100%)',
          status: 'blad',
          opis: 'Odliczasz 100% VAT od pojazdu bez zgłoszonego VAT-26 — US zakwestionuje. Zgłoś do 25. miesiąca po I wydatku albo przełącz na mieszany.',
        }
      : {
          id: 'vat26',
          tytul: 'VAT-26 (pojazd 100%)',
          status: 'ok',
          opis:
            settings.uzytkowaniePojazdu === 'wylacznie_firma'
              ? 'VAT-26 zgłoszony — odliczenie 100% OK (pamiętaj o ewidencji przebiegu).'
              : 'Pojazd mieszany/prywatny — VAT-26 nie jest wymagany.',
        },
  );

  // 7. Niewysłane do KSeF
  const niewyslane = fakturyM.filter((s) => s.status === 'wystawiona');
  out.push({
    id: 'ksef-niewyslane',
    tytul: 'Wysyłka KSeF',
    status: niewyslane.length > 0 ? 'warn' : 'ok',
    opis:
      niewyslane.length > 0
        ? `${niewyslane.length} wystawionych czeka na KSeF: ${niewyslane.map((s) => s.numer).join(', ')} — wyślij masowo jednym klikiem w Integracjach.`
        : 'Wszystkie faktury miesiąca wysłane do KSeF (albo brak faktur).',
  });

  // 8. Nieopłacone po terminie
  const dzis = new Date().toISOString().slice(0, 10);
  const poTerminie = fakturyM.filter((s) => !s.zaplacona && s.terminPlatnosci < dzis);
  out.push({
    id: 'po-terminie',
    tytul: 'Płatności po terminie',
    status: poTerminie.length > 0 ? 'warn' : 'ok',
    opis:
      poTerminie.length > 0
        ? `${poTerminie.length} nieopłaconych po terminie: ${poTerminie.map((s) => `${s.numer} (${s.terminPlatnosci})`).join(', ')}.`
        : 'Brak przeterminowanych płatności w miesiącu.',
  });

  // 9. NRS do przelewu ZUS
  out.push(
    settings.zusNrs && settings.zusNrs.trim()
      ? { id: 'nrs', tytul: 'Rachunek ZUS (NRS)', status: 'ok', opis: 'NRS uzupełniony — składki jednym przelewem do 20.' }
      : { id: 'nrs', tytul: 'Rachunek ZUS (NRS)', status: 'warn', opis: 'Brak NRS (Integracje) — bez niego nie zapłacisz składek; deklaracja DRA przejdzie.' },
  );

  return out;
}

// --- PDF / wydruk faktury ---

export interface Sprzedawca {
  nazwa?: string;
  nip?: string;
  adres?: string;
  email?: string;
  telefon?: string;
  /** URL logo firmy (PNG/SVG) — drukowane w nagłówku faktury */
  logoUrl?: string;
  /** domyślny rachunek firmy (gdy faktura nie ma własnego) */
  rachunek?: string;
  bank?: string;
  /** false → faktura bez VAT ze zwolnieniem podmiotowym (art. 113) */
  vatowiec?: boolean;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stawkaLabel(stawka: number | string): string {
  if (typeof stawka === 'number') return `${Math.round(stawka * 100)}%`;
  return stawka;
}

const kwotaFmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function kw(n: number): string {
  return kwotaFmt.format(Math.round(n * 100) / 100).replace(/\u00a0/g, ' ');
}

function dataPL(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function tytulFaktury(inv: SalesInvoice, vatowiec: boolean): string {
  switch (inv.rodzaj) {
    case 'korygujaca': return 'Faktura korygująca';
    case 'zaliczkowa': return 'Faktura zaliczkowa';
    case 'proforma': return 'Faktura proforma';
    case 'uproszczona': return 'Faktura uproszczona';
    default: return vatowiec ? 'Faktura VAT' : 'Faktura';
  }
}

/**
 * Faktura do wydruku / PDF (art. 106e: daty, numer, sprzedawca, nabywca, pozycje
 * z ilością/ceną/stawką, zestawienie VAT wg stawek, kwota słownie, termin, rachunek, MPP,
 * odwrotne obciążenie / zwolnienie, VAT w PLN dla walut).
 * Otwierana w nowym oknie + window.print() → „Zapisz jako PDF".
 * `opts.motyw: 'ciemny'` — wariant dark-mode; `sprzedawca.logoUrl` — logo w nagłówku.
 */
export function fakturaHtml(inv: SalesInvoice, sprzedawca: Sprzedawca, opts?: { motyw?: 'jasny' | 'ciemny' }): string {
  const v = salesVat(inv);
  const vatowiec = sprzedawca.vatowiec !== false;
  const waluta = (inv.waluta ?? 'PLN').toUpperCase();
  const walutowa = waluta !== 'PLN';
  const dark = opts?.motyw === 'ciemny';
  const fg = dark ? '#eee' : '#111';
  const muted = dark ? '#bbb' : '#5b6472';
  const border = dark ? '#555' : '#d7dce3';
  const th = dark ? '#222' : '#f3f5f8';
  const bg = dark ? '#111' : '#fff';
  const accent = dark ? '#9db8ff' : '#1d4ed8';

  const poStawkach = new Map<string, { netto: number; vat: number }>();
  const wiersze = inv.pozycje
    .map((p, i) => {
      const netto = Math.round(p.ilosc * p.cenaNetto * 100) / 100;
      const vatKwota = typeof p.stawkaVat === 'number' ? Math.round(netto * p.stawkaVat * 100) / 100 : 0;
      const klucz = stawkaLabel(p.stawkaVat);
      const s = poStawkach.get(klucz) ?? { netto: 0, vat: 0 };
      poStawkach.set(klucz, { netto: s.netto + netto, vat: s.vat + vatKwota });
      return (
        `<tr><td class="c">${i + 1}</td><td>${escHtml(p.nazwa)}</td><td class="r">${p.ilosc}</td>` +
        `<td class="r">${kw(p.cenaNetto)}</td><td class="r">${kw(netto)}</td><td class="c">${escHtml(klucz)}</td>` +
        `<td class="r">${kw(vatKwota)}</td><td class="r">${kw(netto + vatKwota)}</td></tr>`
      );
    })
    .join('');
  const zestawienie = [...poStawkach.entries()]
    .map(([st, s]) => `<tr><td class="c">${escHtml(st)}</td><td class="r">${kw(s.netto)}</td><td class="r">${kw(s.vat)}</td><td class="r">${kw(s.netto + s.vat)}</td></tr>`)
    .join('');

  const stawki = new Set(inv.pozycje.map((p) => p.stawkaVat));
  const adnotacje: string[] = [];
  if (inv.rodzaj === 'korygujaca' && inv.korygujeNumer) adnotacje.push(`Korekta do faktury nr <b>${escHtml(inv.korygujeNumer)}</b>.`);
  if (inv.mpp) adnotacje.push('<b>Mechanizm podzielonej płatności</b>');
  if (stawki.has('np') || stawki.has('oo')) adnotacje.push('<b>Odwrotne obciążenie</b> — podatek rozlicza nabywca (art. 28b / art. 17 ust. 1 pkt 7–8 ustawy o VAT).');
  if (stawki.has('zw') || !vatowiec) adnotacje.push('Zwolnienie podmiotowe z VAT — art. 113 ust. 1 ustawy o VAT.');
  if (inv.rodzaj === 'proforma') adnotacje.push('Dokument nie jest fakturą VAT — nie stanowi podstawy do odliczenia podatku.');
  if (inv.trybKsef === 'offline24' || inv.trybKsef === 'awaria') adnotacje.push(`Faktura wystawiona w trybie ${inv.trybKsef === 'awaria' ? 'awaryjnym' : 'offline24'} KSeF.`);

  let walutaInfo = '';
  if (walutowa && inv.kursNbp) {
    const pln = salesVatPln(inv);
    walutaInfo = `<p class="muted">Przeliczenie wg średniego kursu NBP ${String(inv.kursNbp).replace('.', ',')} PLN/${escHtml(waluta)} z dnia roboczego poprzedzającego dzień sprzedaży: netto ${kw(pln.netto)} PLN, VAT <b>${kw(pln.vat)} PLN</b>.</p>`;
  } else if (walutowa) {
    walutaInfo = `<p class="muted">Faktura w walucie ${escHtml(waluta)} — uzupełnij kurs NBP, by wykazać VAT w PLN.</p>`;
  }

  const rachunek = inv.rachunekBankowy || sprzedawca.rachunek;
  const strona = (etykieta: string, nazwa: string, nip: string, adres: string, extra: string[]): string =>
    `<div class="party"><div class="lbl">${etykieta}</div><div class="name">${escHtml(nazwa)}</div>` +
    `${nip ? `<div>NIP: ${escHtml(nip)}</div>` : ''}${adres ? `<div>${escHtml(adres)}</div>` : ''}` +
    extra.filter(Boolean).map((e) => `<div class="muted">${escHtml(e)}</div>`).join('') + '</div>';

  return (
    `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">` +
    `<title>${tytulFaktury(inv, vatowiec)} ${escHtml(inv.numer)}</title>` +
    `<style>@page{size:A4;margin:14mm}*{box-sizing:border-box}` +
    `body{font-family:'Segoe UI',Arial,sans-serif;margin:32px;color:${fg};background:${bg};font-size:13px;line-height:1.45}` +
    `h1{font-size:22px;margin:0;letter-spacing:-.01em}h1 small{display:block;font-size:13px;font-weight:500;color:${muted};margin-top:2px}` +
    `.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid ${accent};padding-bottom:14px}` +
    `.head img{max-height:60px;max-width:220px}.dates{display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:12.5px;text-align:right}` +
    `.dates span{color:${muted}}.parties{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:18px 0}` +
    `.party .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${muted};margin-bottom:4px}.party .name{font-weight:700;font-size:14px}` +
    `table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid ${border};padding:7px 8px;font-size:12.5px;vertical-align:top}` +
    `th{background:${th};text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${muted}}` +
    `.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.c{text-align:center}` +
    `.sum{display:flex;justify-content:space-between;gap:24px;margin-top:16px;align-items:flex-start}.sum table{width:auto;min-width:320px}` +
    `.total{font-size:18px;font-weight:700;color:${accent}}.muted{color:${muted};font-size:12px}` +
    `.box{border:1px solid ${border};border-radius:8px;padding:10px 12px;margin-top:14px}.notes div{margin:2px 0}</style></head><body>` +
    `<div class="head"><div>${sprzedawca.logoUrl ? `<img src="${escHtml(sprzedawca.logoUrl)}" alt="logo firmy"><br>` : ''}` +
    `<h1>${tytulFaktury(inv, vatowiec)} nr ${escHtml(inv.numer)}<small>oryginał</small></h1></div>` +
    `<div class="dates"><span>Data wystawienia:</span><b>${dataPL(inv.dataWystawienia)}</b>` +
    `<span>Data sprzedaży:</span><b>${dataPL(inv.dataSprzedazy)}</b>` +
    `<span>Termin płatności:</span><b>${dataPL(inv.terminPlatnosci)}</b>` +
    `${inv.ksefId ? `<span>Nr KSeF:</span><b>${escHtml(inv.ksefId)}</b>` : ''}</div></div>` +
    `<div class="parties">` +
    strona('Sprzedawca', sprzedawca.nazwa ?? '', sprzedawca.nip ?? '', sprzedawca.adres ?? '', [sprzedawca.email ?? '', sprzedawca.telefon ?? '']) +
    strona('Nabywca', inv.kontrahent.nazwa, inv.kontrahent.nip, inv.kontrahent.adres, [inv.kontrahent.email ?? '']) +
    `</div>` +
    `<table><thead><tr><th class="c">Lp.</th><th>Nazwa towaru / usługi</th><th class="r">Ilość</th><th class="r">Cena netto</th>` +
    `<th class="r">Wartość netto</th><th class="c">VAT</th><th class="r">Kwota VAT</th><th class="r">Brutto</th></tr></thead>` +
    `<tbody>${wiersze}</tbody></table>` +
    `<div class="sum"><div>` +
    `<div class="muted">Do zapłaty</div><div class="total">${kw(v.brutto)} ${escHtml(waluta)}</div>` +
    `<div class="muted">Słownie: ${kwotaSlownie(v.brutto, waluta)}</div>` +
    `</div><table><thead><tr><th class="c">Stawka</th><th class="r">Netto</th><th class="r">VAT</th><th class="r">Brutto</th></tr></thead>` +
    `<tbody>${zestawienie}<tr><td class="c"><b>Razem</b></td><td class="r"><b>${kw(v.netto)}</b></td><td class="r"><b>${kw(v.vat)}</b></td><td class="r"><b>${kw(v.brutto)}</b></td></tr></tbody></table></div>` +
    walutaInfo +
    `<div class="box"><div><span class="muted">Sposób płatności:</span> przelew • <span class="muted">Termin:</span> ${dataPL(inv.terminPlatnosci)}</div>` +
    `${rachunek ? `<div><span class="muted">Rachunek do zapłaty:</span> <b>${escHtml(rachunek)}</b>${sprzedawca.bank && !inv.rachunekBankowy ? ` (${escHtml(sprzedawca.bank)})` : ''}</div>` : ''}` +
    `<div><span class="muted">Tytuł przelewu:</span> ${escHtml(inv.numer)}</div></div>` +
    `${adnotacje.length ? `<div class="box notes">${adnotacje.map((a) => `<div>${a}</div>`).join('')}</div>` : ''}` +
    `</body></html>`
  );
}
