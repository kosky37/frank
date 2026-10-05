import type { CostInvoice, MonthlySums, SalesInvoice } from './types.js';
import { deductibleVatCost, round2, salesVat, vatDue } from './vat.js';

// Integracje e-administracji: JPK_V7M (MF, schemat v2), KSeF FA(3), ZUS DRA.
// Budujemy REALNE payloady (Nagłówek/Podmiot/Ewidencja/Deklaracja,
// Pozycje + Adnotacje MPP, NRS/kod tytułu), ale wysyłkę i podpis zostawiamy
// bramkom (podpis kwalifikowany, KSeF 2.0, PUE/eZUS). Przed pierwszą
// produkcyjną wysyłką zweryfikuj z XSD MF / Płatnikiem.

export interface IntegrationResult {
  ok: boolean;
  payload: string;
  info: string;
}

/** Walidacja NIP wagami MF: 6,5,7,2,3,4,5,6,7 (suma mod 11). */
export function czyNipPoprawny(nip: string): boolean {
  const d = nip.replace(/\D/g, '');
  if (!/^\d{10}$/.test(d)) return false;
  const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d[i]) * wagi[i];
  const k = s % 11;
  return k < 10 && k === Number(d[9]);
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function f2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

function cyfry(s: string | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Mikrorachunek podatkowy: IBAN `PLkk 1010 0071 222NIP 000`,
 * gdzie kk to suma kontrolna ISO 13616 (mod 97) z sufiksem `252100` (= `PL00`).
 * PRZYBLIŻENIE wyliczone lokalnie — przed pierwszym przelewem zweryfikuj
 * w generatorze Ministerstwa Finansów (numer zależy wyłącznie od NIP).
 */
export function mikrorachunek(nip: string): string {
  const d = cyfry(nip);
  if (!/^\d{10}$/.test(d)) throw new Error('NIP musi mieć 10 cyfr.');
  const bban = `10100071222${d}000`; // 8 + 3 + 10 + 3 = 24 cyfry
  let r = 0;
  for (const ch of `${bban}252100`) r = (r * 10 + Number(ch)) % 97;
  const raw = `PL${String(98 - r).padStart(2, '0')}${bban}`;
  const grupy = [4, 8, 12, 16, 20, 24].map((i) => raw.slice(i, i + 4));
  return `${raw.slice(0, 4)} ${grupy.join(' ')}`;
}

export interface JpkPodmiot {
  nip?: string;
  nazwa?: string;
  adres?: string;
  email?: string;
  kodUrzedu?: string;
}

/** Kubełki stawek ewidencji sprzedaży (K_10 zw, K_13 0/np/oo, K_15–K_20). */
interface Kubelki {
  k10: number;
  k13: number;
  k15: number;
  k16: number;
  k17: number;
  k18: number;
  k19: number;
  k20: number;
}

function kubelkiSprzedazy(s: SalesInvoice): Kubelki {
  const k: Kubelki = { k10: 0, k13: 0, k15: 0, k16: 0, k17: 0, k18: 0, k19: 0, k20: 0 };
  for (const p of s.pozycje) {
    const netto = round2(p.ilosc * p.cenaNetto);
    const st = p.stawkaVat;
    const vat = typeof st === 'number' ? round2(netto * st) : 0;
    if (st === 0.23) {
      k.k19 = round2(k.k19 + netto);
      k.k20 = round2(k.k20 + vat);
    } else if (st === 0.08) {
      k.k17 = round2(k.k17 + netto);
      k.k18 = round2(k.k18 + vat);
    } else if (st === 0.05) {
      k.k15 = round2(k.k15 + netto);
      k.k16 = round2(k.k16 + vat);
    } else if (st === 'zw') {
      k.k10 = round2(k.k10 + netto);
    } else {
      k.k13 = round2(k.k13 + netto); // 0% / np / oo
    }
  }
  return k;
}

/** JPK_V7M wg schematu MF v2: Nagłówek + Podmiot1 + Ewidencja + Deklaracja. */
export function buildJpkV7M(
  miesiac: string,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  sums: MonthlySums,
  podmiot: JpkPodmiot = {},
): IntegrationResult {
  const [rok, mm] = miesiac.split('-');
  const ostatni = new Date(Number(rok), Number(mm), 0).getDate();
  const dataWytworzenia = new Date().toISOString();
  const sprz = sales.filter((s) => s.dataSprzedazy.slice(0, 7) === miesiac && s.status !== 'robocza');
  const zakup = costs.filter((c) => c.dataKsiegowania.slice(0, 7) === miesiac);
  const pole = (nazwa: string, v: number): string => (v > 0 ? `      <${nazwa}>${f2(v)}</${nazwa}>\n` : '');
  const wierszeS = sprz
    .map((s, i) => {
      const k = kubelkiSprzedazy(s);
      return (
        `    <SprzedazWiersz>\n      <LpSprzedazy>${i + 1}</LpSprzedazy>\n` +
        `      <KodKrajuNadaniaTIN>PL</KodKrajuNadaniaTIN>\n` +
        `      <NrKontrahenta>${escXml(cyfry(s.kontrahent.nip))}</NrKontrahenta>\n` +
        `      <NazwaKontrahenta>${escXml(s.kontrahent.nazwa)}</NazwaKontrahenta>\n` +
        `      <DowodSprzedazy>${escXml(s.numer)}</DowodSprzedazy>\n` +
        `      <DataWystawienia>${escXml(s.dataWystawienia)}</DataWystawienia>\n` +
        `      <DataSprzedazy>${escXml(s.dataSprzedazy)}</DataSprzedazy>\n` +
        pole('K_10', k.k10) +
        pole('K_13', k.k13) +
        pole('K_15', k.k15) +
        pole('K_16', k.k16) +
        pole('K_17', k.k17) +
        pole('K_18', k.k18) +
        pole('K_19', k.k19) +
        pole('K_20', k.k20) +
        `    </SprzedazWiersz>`
      );
    })
    .join('\n');
  const wierszeZ = zakup
    .map(
      (c, i) =>
        `    <ZakupWiersz>\n      <LpZakupu>${i + 1}</LpZakupu>\n` +
        `      <NrDostawcy>${escXml(cyfry(c.nipWystawcy))}</NrDostawcy>\n` +
        `      <NazwaDostawcy>${escXml(c.wystawca)}</NazwaDostawcy>\n` +
        `      <DowodZakupu>${escXml(c.numer)}</DowodZakupu>\n` +
        `      <DataZakupu>${escXml(c.dataZakupu)}</DataZakupu>\n` +
        `      <K_43>${f2(c.netto)}</K_43>\n` +
        `      <K_44>${f2(deductibleVatCost(c))}</K_44>\n    </ZakupWiersz>`,
    )
    .join('\n');
  const doZaplaty = vatDue(sums.vatNalezny, sums.vatNaliczony);
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<JPK xmlns="http://crd.gov.pl/wzor/2026/01/01/JPK_V7M/" kodSystemowy="JPK_V7M (2)" wariantSchematu="2">\n` +
    `  <Naglowek>\n    <KodFormularza kodSystemowy="JPK_V7M (2)" kodPodatku="VAT" wersjaSchemy="1-2">JPK_V7M</KodFormularza>\n` +
    `    <WariantFormularza>2</WariantFormularza>\n    <CelZlozenia>1</CelZlozenia>\n` +
    `    <DataWytworzeniaJPK>${dataWytworzenia}</DataWytworzeniaJPK>\n` +
    `    <DataZakresuOd>${rok}-${mm}-01</DataZakresuOd>\n` +
    `    <DataZakresuDo>${rok}-${mm}-${String(ostatni).padStart(2, '0')}</DataZakresuDo>\n` +
    `    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n` +
    `    <KodUrzedu>${escXml(podmiot.kodUrzedu ?? '0000')}</KodUrzedu>\n` +
    `    <Rok>${escXml(rok ?? '')}</Rok>\n    <Miesiac>${escXml(mm ?? '')}</Miesiac>\n  </Naglowek>\n` +
    `  <Podmiot1 rola="Podatnik">\n    <OsobaNiefizyczna>\n` +
    `      <NIP>${escXml(cyfry(podmiot.nip))}</NIP>\n` +
    `      <PelnaNazwa>${escXml(podmiot.nazwa ?? '')}</PelnaNazwa>\n    </OsobaNiefizyczna>\n` +
    `    <AdresPodmiotu>${escXml(podmiot.adres ?? '')}</AdresPodmiotu>\n` +
    `    <Email>${escXml(podmiot.email ?? '')}</Email>\n  </Podmiot1>\n` +
    `  <Ewidencja>\n${wierszeS}\n${wierszeZ}\n` +
    `    <SprzedazCtrl>\n      <LiczbaWierszySprzedazy>${sprz.length}</LiczbaWierszySprzedazy>\n` +
    `      <PodatekNalezny>${f2(sums.vatNalezny)}</PodatekNalezny>\n    </SprzedazCtrl>\n` +
    `    <ZakupCtrl>\n      <LiczbaWierszyZakupow>${zakup.length}</LiczbaWierszyZakupow>\n` +
    `      <PodatekNaliczony>${f2(sums.vatNaliczony)}</PodatekNaliczony>\n    </ZakupCtrl>\n  </Ewidencja>\n` +
    `  <Deklaracja>\n    <!-- Orientacyjnie wg broszury MF: P_38 należny, P_39 naliczony, P_51 do zapłaty, P_54 nadwyżka -->\n` +
    `    <P_38>${f2(sums.vatNalezny)}</P_38>\n    <P_39>${f2(sums.vatNaliczony)}</P_39>\n` +
    `    <P_51>${f2(Math.max(0, doZaplaty))}</P_51>\n    <P_54>${f2(Math.max(0, -doZaplaty))}</P_54>\n  </Deklaracja>\n</JPK>`;
  return {
    ok: true,
    payload,
    info: `JPK_V7M ${miesiac}: ${sprz.length} wierszy sprzedaży, ${zakup.length} zakupów. Przed wysyłką do e-Urzędu zweryfikuj z XSD MF; wymagany podpis kwalifikowany.`,
  };
}

/** Faktura FA(3)-like do KSeF: nagłówek, podmioty, pozycje, Adnotacje (MPP). */
export function buildKsefFA3(s: SalesInvoice, nipSprzedawcy: string): IntegrationResult {
  const v = salesVat(s);
  const pozycje = s.pozycje.map((p, i) => {
    const netto = round2(p.ilosc * p.cenaNetto);
    const udzial = typeof p.stawkaVat === 'number' ? p.stawkaVat : 0;
    const vat = round2(netto * udzial);
    const stawkaProc =
      typeof p.stawkaVat === 'number'
        ? `${(p.stawkaVat * 100).toFixed(p.stawkaVat < 0.1 ? 1 : 0)}%`
        : p.stawkaVat;
    return {
      lp: i + 1,
      nazwa: p.nazwa,
      ilosc: p.ilosc,
      cenaNetto: p.cenaNetto,
      stawkaVat: p.stawkaVat,
      stawkaProc,
      netto,
      vat,
      brutto: round2(netto + vat),
    };
  });
  const mpp = s.mpp === true || v.brutto > 15000;
  const payload = JSON.stringify(
    {
      kodSystemowy: 'FA (3)',
      wariantFormularza: 3,
      srodowisko: 'demo (ksef-test.mf.gov.pl)',
      naglowek: { dataWytworzenia: new Date().toISOString(), system: 'Frank-JDG' },
      podmiot1: { rola: 'Sprzedawca', nip: cyfry(nipSprzedawcy) },
      podmiot2: {
        rola: 'Nabywca',
        nip: cyfry(s.kontrahent.nip),
        nazwa: s.kontrahent.nazwa,
        adres: s.kontrahent.adres,
      },
      fa: {
        numer: s.numer,
        dataWystawienia: s.dataWystawienia,
        dataSprzedazy: s.dataSprzedazy,
        terminPlatnosci: s.terminPlatnosci,
        waluta: s.waluta ?? 'PLN',
        kursNbp: s.kursNbp ?? null,
      },
      pozycje,
      podsumowanie: { razemNetto: v.netto, razemVat: v.vat, razemBrutto: v.brutto },
      adnotacje: {
        mpp,
        podzielonaPlatnosc: mpp,
        opis: mpp ? 'Mechanizm podzielonej płatności' : 'Bez MPP',
      },
      platnosc: {
        rachunekBankowy: s.rachunekBankowy ?? null,
        bialaListaSprawdzona: s.bialaListaSprawdzona ?? null,
      },
    },
    null,
    2,
  );
  return {
    ok: true,
    payload,
    info: 'FA(3)-like JSON — wyślij przez KSeF 2.0 (token + certyfikat, ZAW-FA); przed produkcją zweryfikuj ze schematem MF.',
  };
}

/** ZUS DRA (XML-ish): NRS + kod tytułu + okres + składki. */
export function buildZusDraXml(
  miesiac: string,
  sums: MonthlySums,
  nrs: string,
  kodTytulu: string,
  fp = 0,
): IntegrationResult {
  const razem = round2(sums.zusSpoleczne + sums.zusZdrowotna + fp);
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n<ZUSDRA>\n  <Identyfikacja>\n` +
    `    <NRS>${escXml(nrs)}</NRS>\n    <KodTytulu>${escXml(kodTytulu)}</KodTytulu>\n` +
    `    <OkresRozliczeniowy>${escXml(miesiac)}</OkresRozliczeniowy>\n  </Identyfikacja>\n  <Skladki>\n` +
    `    <Spoleczne>${f2(sums.zusSpoleczne)}</Spoleczne>\n` +
    `    <Zdrowotna>${f2(sums.zusZdrowotna)}</Zdrowotna>\n    <FP>${f2(fp)}</FP>\n` +
    `    <Razem>${f2(razem)}</Razem>\n  </Skladki>\n</ZUSDRA>`;
  return {
    ok: true,
    payload,
    info: 'DRA XML-ish (NRS + kod tytułu + okres) — wczytaj w Płatniku / PUE eZUS i sprawdź przed wysyłką.',
  };
}

/** Zestawienie kontrolne do rocznego PIT (e-Deklaracje / Twój e-PIT wypełniasz w usłudze MF). */
export function buildPitRocznyXml(
  formularz: 'PIT-36' | 'PIT-36L' | 'PIT-28',
  rok: string,
  przychod: number,
  koszty: number,
  podatek: number,
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<PIT formularz="${formularz}" rok="${escXml(rok)}"><!-- zestawienie kontrolne, wysyłka w usłudze MF -->\n` +
    `  <Przychod>${f2(przychod)}</Przychod>\n  <Koszty>${f2(koszty)}</Koszty>\n` +
    `  <Podatek>${f2(podatek)}</Podatek>\n</PIT>`
  );
}

// --- Kompatybilność wstecz (te same nazwy/sygnatury, payloady już realne) ---

export function buildJpkV7Stub(
  miesiac: string,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  sums: MonthlySums,
): IntegrationResult {
  const r = buildJpkV7M(miesiac, sales, costs, sums);
  return {
    ...r,
    info: 'JPK_V7M (Nagłówek/Podmiot/Ewidencja/Deklaracja) — przed wysyłką do e-Urzędu zweryfikuj z XSD MF; wymagany podpis kwalifikowany.',
  };
}

export function buildKsefStub(s: SalesInvoice): IntegrationResult {
  const r = buildKsefFA3(s, '0000000000');
  return { ...r, info: 'KSeF FA(3)-like — uzupełnij NIP sprzedawcy i wyślij przez KSeF 2.0 (token/certyfikat).' };
}

export function buildZusDeklaracjaStub(miesiac: string, sums: MonthlySums): IntegrationResult {
  const r = buildZusDraXml(miesiac, sums, '', '01 10');
  return {
    ...r,
    info: 'ZUS DRA XML-ish — uzupełnij NRS i kod tytułu w Integracjach; docelowo Płatnik / eZUS.',
  };
}
