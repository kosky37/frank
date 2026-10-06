// Batch E — logika „polerowania": iCal, backup, audyt przed wysyłką, PDF faktury.
// Czyste funkcje (bez DOM), testowane w batchE.test.ts.

import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { salesVat } from '../../src-shared/tax/vat.js';
import { czyNipPoprawny } from '../../src-shared/tax/integrations.js';
import { brakiArt106e } from './quickwins.js';

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

/**
 * Faktura do wydruku / PDF (art. 106e: 11 pól — daty, numer, sprzedawca,
 * nabywca, pozycje z ilością/ceną/stawką, podsumowanie VAT, termin, rachunek+MPP).
 * Otwierana w nowym oknie + window.print() → „Zapisz jako PDF".
 * `opts.motyw: 'ciemny'` — wariant dark-mode; `sprzedawca.logoUrl` — logo w nagłówku.
 */
export function fakturaHtml(inv: SalesInvoice, sprzedawca: Sprzedawca, opts?: { motyw?: 'jasny' | 'ciemny' }): string {
  const v = salesVat(inv);
  const dark = opts?.motyw === 'ciemny';
  const fg = dark ? '#eee' : '#111';
  const muted = dark ? '#bbb' : '#555';
  const border = dark ? '#666' : '#999';
  const th = dark ? '#222' : '#f0f0f0';
  const bg = dark ? '#111' : '#fff';
  const wiersze = inv.pozycje
    .map((p, i) => {
      const netto = Math.round(p.ilosc * p.cenaNetto * 100) / 100;
      const vatKwota = typeof p.stawkaVat === 'number' ? Math.round(netto * p.stawkaVat * 100) / 100 : 0;
      return (
        `<tr><td>${i + 1}</td><td>${escHtml(p.nazwa)}</td><td style="text-align:right">${p.ilosc}</td>` +
        `<td style="text-align:right">${p.cenaNetto.toFixed(2)}</td>` +
        `<td style="text-align:right">${netto.toFixed(2)}</td><td>${stawkaLabel(p.stawkaVat)}</td>` +
        `<td style="text-align:right">${vatKwota.toFixed(2)}</td>` +
        `<td style="text-align:right">${(netto + vatKwota).toFixed(2)}</td></tr>`
      );
    })
    .join('');
  return (
    `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">` +
    `<title>Faktura ${escHtml(inv.numer)}</title>` +
    `<style>body{font-family:Arial,sans-serif;margin:40px;color:${fg};background:${bg}}` +
    `h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}` +
    `th,td{border:1px solid ${border};padding:6px 8px;font-size:13px}` +
    `th{background:${th}}.box{display:flex;gap:32px;margin-top:16px}` +
    `.box div{flex:1}.muted{color:${muted};font-size:12px}` +
    `.head{display:flex;justify-content:space-between;align-items:center;gap:16px}` +
    `.head img{max-height:60px;max-width:220px}</style></head><body>` +
    `<div class="head"><h1>Faktura ${escHtml(inv.numer)}</h1>` +
    `${sprzedawca.logoUrl ? `<img src="${escHtml(sprzedawca.logoUrl)}" alt="logo firmy">` : ''}</div>` +
    `<p class="muted">Data wystawienia: ${escHtml(inv.dataWystawienia)} • Data sprzedaży: ${escHtml(inv.dataSprzedazy)} • Termin płatności: ${escHtml(inv.terminPlatnosci)}${inv.ksefId ? ` • KSeF: ${escHtml(inv.ksefId)}` : ''}</p>` +
    `<div class="box"><div><b>Sprzedawca</b><br>${escHtml(sprzedawca.nazwa ?? '')}<br>NIP ${escHtml(sprzedawca.nip ?? '')}<br>${escHtml(sprzedawca.adres ?? '')}${sprzedawca.email ? `<br>${escHtml(sprzedawca.email)}` : ''}${sprzedawca.telefon ? `<br>${escHtml(sprzedawca.telefon)}` : ''}</div>` +
    `<div><b>Nabywca</b><br>${escHtml(inv.kontrahent.nazwa)}<br>NIP ${escHtml(inv.kontrahent.nip)}<br>${escHtml(inv.kontrahent.adres)}${inv.kontrahent.email ? `<br>${escHtml(inv.kontrahent.email)}` : ''}</div></div>` +
    `<table><thead><tr><th>Lp.</th><th>Nazwa</th><th>Ilość</th><th>Cena netto</th><th>Wartość netto</th><th>VAT</th><th>Kwota VAT</th><th>Brutto</th></tr></thead>` +
    `<tbody>${wiersze}</tbody></table>` +
    `<p style="text-align:right"><b>Razem netto: ${v.netto.toFixed(2)} • VAT: ${v.vat.toFixed(2)} • Brutto: ${v.brutto.toFixed(2)} PLN</b>` +
    `${inv.waluta && inv.waluta !== 'PLN' ? `<br><span class="muted">Waluta: ${escHtml(inv.waluta)}${inv.kursNbp ? `, kurs NBP ${inv.kursNbp}` : ''} — VAT rozliczony w PLN.</span>` : ''}</p>` +
    `${inv.rachunekBankowy ? `<p>Rachunek do zapłaty: ${escHtml(inv.rachunekBankowy)}</p>` : ''}` +
    `${inv.mpp ? '<p><b>Mechanizm podzielonej płatności (MPP)</b></p>' : ''}` +
    `</body></html>`
  );
}
