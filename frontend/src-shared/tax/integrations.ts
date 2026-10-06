import type { CostInvoice, MonthlySums, SalesInvoice } from './types.js';
import { deductibleVatCost, round2, salesVat, vatDue } from './vat.js';

// Integracje e-administracji: JPK_V7M/V7K (podgląd lokalny), KSeF FA(3) (podgląd),
// ZUS DRA (podgląd), PIT roczny.
// PRAWDZIWE wysyłki robi backend (.NET): FA(3) XML + szyfrowanie KSeF 2.0,
// JPK_V7M(3)/V7K(3) wg XSD MF + bramka e-Dokumenty (dane autoryzujące),
// KEDU 5.6 do Płatnika/ePłatnika. Tutejsze buildJpk*/buildKsefFA3/buildZusDraXml
// służą jako lokalne podglądy/robocze pliki — przed wysyłką produkcyjną
// używaj endpointów /api/ksef, /api/jpk, /api/zus (walidacja XSD po stronie backendu).

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

/**
 * JPK_V7K za kwartał (`YYYY-Q1..Q4`): ewidencja z 3 miesięcy + deklaracja
 * kwartalna (P_38/P_39/P_51/P_54). Uproszczona koperta wariantu V7K —
 * przed wysyłką zweryfikuj z XSD MF jak V7M.
 */
export function buildJpkV7K(
  kwartal: string,
  sales: SalesInvoice[],
  costs: CostInvoice[],
  sums: MonthlySums,
  podmiot: JpkPodmiot = {},
): IntegrationResult {
  const m = /^(\d{4})-Q([1-4])$/.exec(kwartal.trim());
  const rok = m?.[1] ?? kwartal.slice(0, 4);
  const q = m ? Number(m[2]) : 1;
  const miesiace = [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3].map(
    (mm) => `${rok}-${String(mm).padStart(2, '0')}`,
  );
  const wMiesiacu = (d: string): boolean => miesiace.some((mm) => d.startsWith(mm));
  const sprz = sales.filter((s) => wMiesiacu(s.dataSprzedazy) && s.status !== 'robocza');
  const zakup = costs.filter((c) => wMiesiacu(c.dataKsiegowania));
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
  const dataWytworzenia = new Date().toISOString();
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<JPK xmlns="http://crd.gov.pl/wzor/2026/01/01/JPK_V7K/" kodSystemowy="JPK_V7K (2)" wariantSchematu="2">\n` +
    `  <Naglowek>\n    <KodFormularza kodSystemowy="JPK_V7K (2)" kodPodatku="VAT" wersjaSchemy="1-2">JPK_V7K</KodFormularza>\n` +
    `    <WariantFormularza>2</WariantFormularza>\n    <CelZlozenia>1</CelZlozenia>\n` +
    `    <DataWytworzeniaJPK>${dataWytworzenia}</DataWytworzeniaJPK>\n` +
    `    <DataZakresuOd>${miesiace[0]}-01</DataZakresuOd>\n` +
    `    <DataZakresuDo>${miesiace[2]}-${String(new Date(Number(rok), Number(miesiace[2].slice(5, 7)), 0).getDate()).padStart(2, '0')}</DataZakresuDo>\n` +
    `    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n` +
    `    <KodUrzedu>${escXml(podmiot.kodUrzedu ?? '0000')}</KodUrzedu>\n` +
    `    <Rok>${escXml(rok ?? '')}</Rok>\n    <Kwartal>${q}</Kwartal>\n  </Naglowek>\n` +
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
    `  <Deklaracja>\n` +
    `    <P_38>${f2(sums.vatNalezny)}</P_38>\n    <P_39>${f2(sums.vatNaliczony)}</P_39>\n` +
    `    <P_51>${f2(Math.max(0, doZaplaty))}</P_51>\n    <P_54>${f2(Math.max(0, -doZaplaty))}</P_54>\n  </Deklaracja>\n</JPK>`;
  return {
    ok: true,
    payload,
    info: `JPK_V7K ${kwartal}: ${sprz.length} wierszy sprzedaży, ${zakup.length} zakupów (ewidencja z 3 miesięcy, deklaracja kwartalna). Przed wysyłką zweryfikuj z XSD MF; wymagany podpis kwalifikowany.`,
  };
}

export interface JpkWalidacja {
  ok: boolean;
  bledy: string[];
}

/**
 * Lekka walidacja strukturalna JPK_V7M/V7K (nie zastępuje XSD MF — przed wysyłką
 * do e-Urzędu zweryfikuj plik schematem ze strony Ministerstwa Finansów).
 */
export function walidujJpkV7(xml: string): JpkWalidacja {
  const bledy: string[] = [];
  const has = (t: string): boolean => xml.includes(t);
  if (!xml.trimStart().startsWith('<?xml')) bledy.push('brak deklaracji XML');
  const wariant = xml.includes('JPK_V7K') ? 'JPK_V7K' : xml.includes('JPK_V7M') ? 'JPK_V7M' : null;
  if (!wariant) bledy.push('brak korzenia JPK_V7M/JPK_V7K');
  for (const tag of ['<Naglowek>', '<KodFormularza', '<DataWytworzeniaJPK>', '<Podmiot1', '<NIP>', '<Ewidencja>', '<Deklaracja>', '<P_38>', '<P_39>']) {
    if (!has(tag)) bledy.push(`brak elementu ${tag}`);
  }
  if (wariant === 'JPK_V7M' && !has('<Miesiac>')) bledy.push('brak elementu <Miesiac>');
  if (wariant === 'JPK_V7K' && !has('<Kwartal>')) bledy.push('brak elementu <Kwartal>');
  const nip = /<NIP>(\d*)<\/NIP>/.exec(xml)?.[1] ?? '';
  if (nip !== '' && !/^\d{10}$/.test(nip)) bledy.push('NIP podmiotu nie ma 10 cyfr');
  const licz = (tag: string): number => xml.split(tag).length - 1;
  const sprzCtrl = /<LiczbaWierszySprzedazy>(\d+)<\/LiczbaWierszySprzedazy>/.exec(xml)?.[1];
  if (sprzCtrl !== undefined && Number(sprzCtrl) !== licz('<SprzedazWiersz>')) {
    bledy.push('licznik SprzedazCtrl nie zgadza się z wierszami');
  }
  const zakCtrl = /<LiczbaWierszyZakupow>(\d+)<\/LiczbaWierszyZakupow>/.exec(xml)?.[1];
  if (zakCtrl !== undefined && Number(zakCtrl) !== licz('<ZakupWiersz>')) {
    bledy.push('licznik ZakupCtrl nie zgadza się z wierszami');
  }
  for (const tag of ['P_51', 'P_54']) {
    const v = new RegExp(`<${tag}>([0-9.]+)</${tag}>`).exec(xml)?.[1];
    if (v !== undefined && !(Number(v) >= 0)) bledy.push(`ujemna wartość ${tag}`);
  }
  return { ok: bledy.length === 0, bledy };
}

/**
 * JPK_PKPIR (miesięczne wiersze KPiR za rok; pierwsza wysyłka w 2027 za 2026).
 * Wiersz = agregat miesiąca: przychód, koszty, dochód.
 */
export function buildJpkPkpir(
  rok: string,
  miesieczne: MonthlySums[],
  podmiot: JpkPodmiot = {},
): IntegrationResult {
  const dataWytworzenia = new Date().toISOString();
  const wiersze = miesieczne
    .map((s, i) => {
      const dochod = round2(s.przychodNetto - s.kosztyNettoPit);
      return (
        `    <PKPIRWiersz>\n      <Lp>${i + 1}</Lp>\n` +
        `      <Miesiac>${escXml(s.miesiac)}</Miesiac>\n` +
        `      <Przychod>${f2(s.przychodNetto)}</Przychod>\n` +
        `      <Koszty>${f2(s.kosztyNettoPit)}</Koszty>\n` +
        `      <Dochod>${f2(dochod)}</Dochod>\n    </PKPIRWiersz>`
      );
    })
    .join('\n');
  const razemP = round2(miesieczne.reduce((a, s) => a + s.przychodNetto, 0));
  const razemK = round2(miesieczne.reduce((a, s) => a + s.kosztyNettoPit, 0));
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<JPK xmlns="http://crd.gov.pl/wzor/2026/01/01/JPK_PKPIR/" kodSystemowy="JPK_PKPIR (2)">\n` +
    `  <Naglowek>\n    <KodFormularza>JPK_PKPIR</KodFormularza>\n` +
    `    <DataWytworzeniaJPK>${dataWytworzenia}</DataWytworzeniaJPK>\n` +
    `    <Rok>${escXml(rok)}</Rok>\n    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n  </Naglowek>\n` +
    `  <Podmiot1>\n    <NIP>${escXml(cyfry(podmiot.nip))}</NIP>\n` +
    `    <PelnaNazwa>${escXml(podmiot.nazwa ?? '')}</PelnaNazwa>\n  </Podmiot1>\n` +
    `  <PKPIR>\n${wiersze}\n` +
    `    <PKPIRCtrl>\n      <LiczbaWierszy>${miesieczne.length}</LiczbaWierszy>\n` +
    `      <SumaPrzychodow>${f2(razemP)}</SumaPrzychodow>\n` +
    `      <SumaKosztow>${f2(razemK)}</SumaKosztow>\n    </PKPIRCtrl>\n  </PKPIR>\n</JPK>`;
  return { ok: true, payload, info: `JPK_PKPIR ${rok}: ${miesieczne.length} wierszy miesięcznych. Trzymaj co miesiąc — pierwsza wysyłka w 2027 za 2026.` };
}

/**
 * JPK_EWP (ewidencja przychodów ryczałtowca: przychód w rozbiciu na stawki).
 */
export function buildJpkEwp(
  rok: string,
  miesieczne: MonthlySums[],
  podmiot: JpkPodmiot = {},
): IntegrationResult {
  const dataWytworzenia = new Date().toISOString();
  const wiersze = miesieczne
    .map((s, i) => {
      const stawki = s.ryczaltSplit.length > 0
        ? s.ryczaltSplit.map((p) => `      <Stawka wartosc="${p.stawka}">${f2(p.przychod)}</Stawka>`).join('\n')
        : '      <Stawka wartosc="0">0.00</Stawka>';
      return (
        `    <EWPWiersz>\n      <Lp>${i + 1}</Lp>\n` +
        `      <Miesiac>${escXml(s.miesiac)}</Miesiac>\n` +
        `      <Przychod>${f2(s.przychodNetto)}</Przychod>\n${stawki}\n    </EWPWiersz>`
      );
    })
    .join('\n');
  const razem = round2(miesieczne.reduce((a, s) => a + s.przychodNetto, 0));
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<JPK xmlns="http://crd.gov.pl/wzor/2026/01/01/JPK_EWP/" kodSystemowy="JPK_EWP (2)">\n` +
    `  <Naglowek>\n    <KodFormularza>JPK_EWP</KodFormularza>\n` +
    `    <DataWytworzeniaJPK>${dataWytworzenia}</DataWytworzeniaJPK>\n` +
    `    <Rok>${escXml(rok)}</Rok>\n    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n  </Naglowek>\n` +
    `  <Podmiot1>\n    <NIP>${escXml(cyfry(podmiot.nip))}</NIP>\n` +
    `    <PelnaNazwa>${escXml(podmiot.nazwa ?? '')}</PelnaNazwa>\n  </Podmiot1>\n` +
    `  <EWP>\n${wiersze}\n` +
    `    <EWPCtrl>\n      <LiczbaWierszy>${miesieczne.length}</LiczbaWierszy>\n` +
    `      <SumaPrzychodow>${f2(razem)}</SumaPrzychodow>\n    </EWPCtrl>\n  </EWP>\n</JPK>`;
  return { ok: true, payload, info: `JPK_EWP ${rok}: ewidencja przychodów wg stawek ryczałtu (wymóg art. 15).` };
}

export interface SrodekDoJpk {
  nazwa: string;
  wartosc: number;
  umorzenie: number;
}

/** JPK_ST: ewidencja środków trwałych (z rejestru amortyzacji). */
export function buildJpkSt(srodki: SrodekDoJpk[], podmiot: JpkPodmiot = {}): IntegrationResult {
  const dataWytworzenia = new Date().toISOString();
  const wiersze = srodki
    .map((s, i) => {
      const netto = round2(s.wartosc - s.umorzenie);
      return (
        `    <STWiersz>\n      <Lp>${i + 1}</Lp>\n` +
        `      <Nazwa>${escXml(s.nazwa)}</Nazwa>\n` +
        `      <WartoscPoczatkowa>${f2(s.wartosc)}</WartoscPoczatkowa>\n` +
        `      <Umorzenie>${f2(s.umorzenie)}</Umorzenie>\n` +
        `      <WartoscNetto>${f2(netto)}</WartoscNetto>\n    </STWiersz>`
      );
    })
    .join('\n');
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<JPK xmlns="http://crd.gov.pl/wzor/2026/01/01/JPK_ST/" kodSystemowy="JPK_ST (2)">\n` +
    `  <Naglowek>\n    <KodFormularza>JPK_ST</KodFormularza>\n` +
    `    <DataWytworzeniaJPK>${dataWytworzenia}</DataWytworzeniaJPK>\n` +
    `    <NazwaSystemu>Frank-JDG</NazwaSystemu>\n  </Naglowek>\n` +
    `  <Podmiot1>\n    <NIP>${escXml(cyfry(podmiot.nip))}</NIP>\n` +
    `    <PelnaNazwa>${escXml(podmiot.nazwa ?? '')}</PelnaNazwa>\n  </Podmiot1>\n` +
    `  <ST>\n${wiersze}\n    <STCtrl>\n      <LiczbaWierszy>${srodki.length}</LiczbaWierszy>\n    </STCtrl>\n  </ST>\n</JPK>`;
  return { ok: true, payload, info: `JPK_ST: ${srodki.length} środków trwałych z rejestru amortyzacji.` };
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
      tryb: s.trybKsef ?? 'online',
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
        zalacznik15: s.zal15 === true,
        korekta: s.rodzaj === 'korygujaca',
        korygujeNumer: s.korygujeNumer ?? null,
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

export interface PitRocznyDane {
  przychod: number;
  koszty: number;
  podatek: number;
  danina?: number;
  /** wiersze PIT/B (przychody/koszty pozarolniczej działalności) */
  pitB?: { opis: string; przychod: number; koszty: number }[];
  /** ulgi z PIT/O (IP Box, B+R) */
  ulgi?: { kod: string; kwota: number }[];
}

/**
 * Rozszerzony XML rocznego PIT: nagłówek + PIT/B + PIT/O (ulgi) + PIT-DS (danina).
 * Zestawienie robocze do wklejenia w Twój e-PIT / e-Deklaracje — przed wysyłką
 * zweryfikuj z urzędowym schematem (PIT/B, PIT/O, PIT-DS).
 */
export function buildPitRocznyXmlFull(
  formularz: 'PIT-36' | 'PIT-36L' | 'PIT-28',
  rok: string,
  dane: PitRocznyDane,
): IntegrationResult {
  const wierszeB = (dane.pitB ?? [])
    .map(
      (w, i) =>
        `    <WierszB>\n      <Lp>${i + 1}</Lp>\n` +
        `      <Opis>${escXml(w.opis)}</Opis>\n` +
        `      <Przychod>${f2(w.przychod)}</Przychod>\n` +
        `      <Koszty>${f2(w.koszty)}</Koszty>\n    </WierszB>`,
    )
    .join('\n');
  const wierszeO = (dane.ulgi ?? [])
    .map((u) => `    <Ulga kod="${escXml(u.kod)}">${f2(u.kwota)}</Ulga>`)
    .join('\n');
  const payload =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<PIT formularz="${formularz}" rok="${escXml(rok)}"><!-- zestawienie robocze, wysyłka aktywnie w usłudze MF -->\n` +
    `  <Przychod>${f2(dane.przychod)}</Przychod>\n  <Koszty>${f2(dane.koszty)}</Koszty>\n` +
    `  <Podatek>${f2(dane.podatek)}</Podatek>\n` +
    `  <ZalacznikB>\n${wierszeB}\n  </ZalacznikB>\n` +
    `  <ZalacznikO>\n${wierszeO}\n  </ZalacznikO>\n` +
    `  <DaninaSolidarnosciowa>${f2(dane.danina ?? 0)}</DaninaSolidarnosciowa>\n</PIT>`;
  return {
    ok: true,
    payload,
    info: `${formularz} ${rok}: podatek ${f2(dane.podatek)} + danina ${f2(dane.danina ?? 0)}. PIT-36/36L/28 wysyłasz aktywnie (Twój e-PIT ich nie akceptuje z automatu).`,
  };
}
