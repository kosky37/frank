// Klient REST do backendu .NET (Frank.Api).
// W dev Vite proxy przekazuje /api -> http://localhost:5203,
// w Dockerze ten sam origin serwuje API + statyczny frontend.

import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { PKD, RYCZALT, type PkdEntry, type RyczaltEntry } from '../../src-shared/dictionaries.js';
import { DEFAULT_SETTINGS, stawkiNaRok, type Rates2026 } from '../../src-shared/tax/rates2026.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      ...init,
    });
    if (!res.ok) {
      // Backend zwraca { code, message } z konkretnym powodem (np. BRAK_NIP, KSEF_BLAD)
      // — dołącz go, inaczej użytkownik widzi tylko gołe "HTTP 400".
      let detail = '';
      try {
        const j = (await res.json()) as { message?: unknown };
        if (j && typeof j.message === 'string' && j.message.trim()) detail = `: ${j.message.trim()}`;
      } catch {
        /* pusty / nie-JSON body */
      }
      throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path}: HTTP ${res.status}${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const body = (v: unknown): RequestInit => ({ body: JSON.stringify(v) });

/** Backend trzyma PKD jako JSON-string (pkdJson); frontend operuje na tablicy. */
export function mapSettingsIn(raw: Record<string, unknown>): TaxpayerSettings {
  let pkd: string[] | undefined;
  try {
    const v = JSON.parse(String(raw['pkdJson'] ?? '[]'));
    if (Array.isArray(v)) pkd = v.filter((x): x is string => typeof x === 'string');
  } catch {
    /* ignore */
  }
  const { pkdJson: _ignored, ...rest } = raw;
  void _ignored;
  const s = { ...(rest as object), pkd } as TaxpayerSettings & Record<string, unknown>;
  // Normalizacja legacy schematów ZUS (ulgowy→start, maly→maly_plus)
  if (s.zusSchemat === 'ulgowy') s.zusSchemat = 'start';
  if (s.zusSchemat === 'maly') s.zusSchemat = 'maly_plus';
  // FIX NaN: backend serializuje `ZusFpMies` jako `zusFpMies`, frontend oczekuje `zusFPMies`.
  // Akceptuj obie pisownie (starsze localStorage / API), kanonicznie `zusFPMies`.
  const fpLegacy = (s as Record<string, unknown>)['zusFpMies'];
  if ((s.zusFPMies === undefined || s.zusFPMies === null) && typeof fpLegacy === 'number') {
    s.zusFPMies = fpLegacy as number;
  }
  if (typeof s.zusFPMies !== 'number' || !Number.isFinite(s.zusFPMies)) {
    s.zusFPMies = DEFAULT_SETTINGS.zusFPMies;
  }
  if (typeof s.zusSpoleczneMies !== 'number' || !Number.isFinite(s.zusSpoleczneMies)) {
    s.zusSpoleczneMies = DEFAULT_SETTINGS.zusSpoleczneMies;
  }
  if (typeof s.zusZdrowotnaMies !== 'number' || !Number.isFinite(s.zusZdrowotnaMies)) {
    s.zusZdrowotnaMies = DEFAULT_SETTINGS.zusZdrowotnaMies;
  }
  return s as TaxpayerSettings;
}

export const api = {
  sales: (): Promise<SalesInvoice[]> => req('/sales'),
  addSale: (inv: SalesInvoice): Promise<SalesInvoice> =>
    req('/sales', { method: 'POST', ...body(inv) }),
  deleteSale: (id: string): Promise<void> => req(`/sales/${id}`, { method: 'DELETE' }),
  updateSale: (inv: SalesInvoice): Promise<SalesInvoice> =>
    req(`/sales/${inv.id}`, { method: 'PUT', ...body(inv) }),

  costs: (): Promise<CostInvoice[]> => req('/costs'),
  addCost: (c: CostInvoice): Promise<CostInvoice> =>
    req('/costs', { method: 'POST', ...body(c) }),
  deleteCost: (id: string): Promise<void> => req(`/costs/${id}`, { method: 'DELETE' }),
  updateCost: (c: CostInvoice): Promise<CostInvoice> =>
    req(`/costs/${c.id}`, { method: 'PUT', ...body(c) }),

  settings: (): Promise<TaxpayerSettings> =>
    req<Record<string, unknown>>('/settings').then(mapSettingsIn),
  saveSettings: (s: TaxpayerSettings): Promise<TaxpayerSettings> =>
    req<Record<string, unknown>>('/settings', {
      method: 'PUT',
      // Wysyłaj obie pisownie FP dla starych backendów / baz.
      ...body({ ...s, zusFpMies: s.zusFPMies, pkdJson: JSON.stringify(s.pkd ?? []) }),
    }).then(mapSettingsIn),

  contractors: (): Promise<ContractorFull[]> => req('/kontrahenci'),
  addContractor: (c: ContractorFull): Promise<ContractorFull> =>
    req('/kontrahenci', { method: 'POST', ...body(c) }),
  updateContractor: (c: ContractorFull): Promise<ContractorFull> =>
    req(`/kontrahenci/${c.id}`, { method: 'PUT', ...body(c) }),
  deleteContractor: (id: string): Promise<void> =>
    req(`/kontrahenci/${id}`, { method: 'DELETE' }),

  /** Podmiot z rejestrów po NIP (Biała Lista VAT + KRS). Rzuca ApiError (400/404/504). */
  registryLookup: (nip: string): Promise<RegistrySubject> =>
    req(`/rejestry/podmiot?nip=${encodeURIComponent(nip)}`, undefined, 15000),

  /** Kontrahent UE w VIES (do WDT/WNT/eksportu 0%). Rzuca ApiError (400/404/504). */
  viesLookup: (kraj: string, nip: string): Promise<ViesWynik> =>
    req(`/rejestry/vies?kraj=${encodeURIComponent(kraj)}&nip=${encodeURIComponent(nip)}`, undefined, 15000),

  /** Podmiot z GUS REGON (wymaga klucza BIR w Ustawieniach). Rzuca ApiError (400/404/504). */
  gusLookup: (nip: string): Promise<GusWynik> =>
    req(`/rejestry/gus?nip=${encodeURIComponent(nip)}`, undefined, 15000),

  pkd: (): Promise<PkdEntry[]> => req<PkdEntry[]>('/slowniki/pkd').catch(() => PKD),
  /** Urzędy skarbowe ze słownika MF (kod + nazwa) — wyszukiwarka po mieście/nazwie. */
  urzedy: (q = ''): Promise<UrzadSk[]> =>
    req<UrzadSk[]>(`/slowniki/urzedy?q=${encodeURIComponent(q)}`).catch(() => []),
  ryczaltRates: (): Promise<RyczaltEntry[]> => req<RyczaltEntry[]>('/slowniki/ryczalt').catch(() => RYCZALT),
  /** Stawki roczne ZUS/limitów z API (fallback: wbudowana tabela). */
  stawki: (rok: number): Promise<Rates2026> =>
    req<Record<string, number>>(`/slowniki/stawki?rok=${rok}`)
      .then((s) => {
        const base = stawkiNaRok(rok);
        return {
          ...base,
          zusDuzySpoleczne: s['zusDuzySpoleczne'] ?? base.zusDuzySpoleczne,
          // backend serializuje `ZusDuzyFp` jako `zusDuzyFp`, frontend historycznie `zusDuzyFP` — akceptuj obie.
          zusDuzyFP: s['zusDuzyFP'] ?? s['zusDuzyFp'] ?? base.zusDuzyFP,
          zusZdrowotnaMinLiniowy: s['zusZdrowotnaMin'] ?? base.zusZdrowotnaMinLiniowy,
          zusZdrowotnaMinRyczalt: s['zusZdrowotnaMin'] ?? base.zusZdrowotnaMinRyczalt,
          liniowyZdrowotnaLimitRoczny: s['liniowyZdrowotnaLimit'] ?? base.liniowyZdrowotnaLimitRoczny,
          vatLimitZwolnienia: s['vatLimitZwolnienia'] ?? base.vatLimitZwolnienia,
        };
      })
      .catch(() => stawkiNaRok(rok)),

  ksef: {
    /** Status konfiguracji (środowisko, czy token wklejony). */
    status: (): Promise<KsefStatus> => req('/ksef/status'),
    /** Test połączenia: uwierzytelnienie tokenem w KSeF (bez wysyłki). */
    sprawdz: (): Promise<{ ok: boolean; srodowisko: string; info: string }> =>
      req('/ksef/sprawdz', { method: 'POST', ...body({}) }, 90000),
    /** Wysyłka faktury jako FA(3) do KSeF (budowa XML + szyfrowanie po stronie backendu). */
    wyslij: (idFaktury: string, srodowisko?: string): Promise<KsefWysylka> =>
      req('/ksef/wyslij', { method: 'POST', ...body({ idFaktury, srodowisko }) }, 120000),
    /** Pobranie UPO wysłanej faktury. */
    upo: (sesjaRef: string, fakturaRef: string): Promise<{ srodowisko: string; upo: unknown }> =>
      req(`/ksef/upo?sesjaRef=${encodeURIComponent(sesjaRef)}&fakturaRef=${encodeURIComponent(fakturaRef)}`, undefined, 90000),
    /** Odbiór metadanych faktur zakupowych (jestem nabywcą). */
    odbior: (od?: string, doDnia?: string, srodowisko?: string): Promise<KsefOdbiorWynik> =>
      req('/ksef/odbior', { method: 'POST', ...body({ od, do: doDnia, srodowisko }) }, 90000),
    /** Podgląd FA(3) XML bez wysyłki (weryfikacja przed wysyłką). */
    podglad: (idFaktury: string): Promise<{ xml: string; formCode: string; schemaVersion: string; walidacja: { ok: boolean; bledy: string[]; pominieta: boolean } }> =>
      req(`/ksef/podglad?idFaktury=${encodeURIComponent(idFaktury)}`, undefined, 30000),
  },

  jpk: {
    /** Podgląd JPK_V7M(3)/V7K(3) z danych w bazie + walidacja XSD MF. */
    podglad: (miesiac?: string, kwartal?: string): Promise<JpkPodglad> => {
      const q = miesiac ? `?miesiac=${encodeURIComponent(miesiac)}` : `?kwartal=${encodeURIComponent(kwartal ?? '')}`;
      return req(`/jpk/podglad${q}`, undefined, 30000);
    },
    /** Wysyłka JPK danymi autoryzującymi (NIP/PESEL + imię + nazwisko + data ur. + przychód sprzed 2 lat). */
    wyslij: (r: JpkWyslijReq): Promise<JpkWyslijWynik> =>
      req('/jpk/wyslij', { method: 'POST', ...body(r) }, 400000),
    /** Status przetwarzania / UPO po referenceNumber. */
    status: (referenceNumber: string, srodowisko?: string): Promise<Record<string, unknown>> =>
      req(`/jpk/status/${encodeURIComponent(referenceNumber)}?srodowisko=${encodeURIComponent(srodowisko ?? 'test')}`, undefined, 30000),
  },

  zus: {
    /** Propozycja wartości DRA z wyliczeń aplikacji (podział na fundusze, podstawy, blok XI). */
    keduPropozycja: (miesiac: string): Promise<ZusPropozycja> =>
      req(`/zus/kedu-propozycja?miesiac=${encodeURIComponent(miesiac)}`, undefined, 30000),
    /** Budowa pliku KEDU 5.6 do importu w Płatniku/ePłatniku (+ walidacja XSD ZUS). */
    kedu: (r: ZusKeduReq): Promise<{ xml: string; walidacja: { ok: boolean; bledy: string[]; pominieta: boolean }; importInfo: string }> =>
      req('/zus/kedu', { method: 'POST', ...body(r) }, 30000),
  },
};

export interface ContractorFull {  id: string;
  nazwa: string;
  nip: string;
  regon?: string;
  adres: string;
  email?: string;
  telefon?: string;
  notatki?: string;
  zrodlo: string;
}

export interface RegistrySubject {
  nazwa: string;
  nip: string;
  regon?: string;
  krs?: string;
  adres: string;
  email?: string;
  statusVat: string;
  pkd: string[];
  zrodla: string[];
}

export interface ViesWynik {
  kraj: string;
  nip: string;
  aktywny: boolean;
  nazwa?: string | null;
  adres?: string | null;
}

export interface GusWynik {
  nazwa: string;
  nip: string;
  regon?: string | null;
  adres: string;
}

/** Urząd skarbowy ze słownika MF (`GET /api/slowniki/urzedy`). */
export interface UrzadSk {
  kod: string;
  nazwa: string;
}

export interface KsefStatus {
  srodowisko: string;
  skonfigurowany: boolean;
  api: string;
  aplikacja: string;
}

export interface KsefWysylka {
  ksefNumber?: string | null;
  fakturaRef?: string;
  sesjaRef?: string;
  srodowisko?: string;
  info?: string;
}

export interface KsefMeta {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  seller: { nip: string; name?: string | null };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency?: string;
}

export interface KsefOdbiorWynik {
  srodowisko: string;
  od: string;
  doDnia: string;
  wynik: { invoices?: KsefMeta[]; hasMore?: boolean; isTruncated?: boolean };
}

export interface JpkPodglad {
  formCode: string;
  schemaVersion: string;
  xml: string;
  walidacja: { ok: boolean; bledy: string[]; pominieta: boolean };
  pominiete?: string[];
  /** Brakujące dane w Ustawieniach (podgląd wstawił placeholdery). Puste = komplet. */
  braki?: string[];
  uwaga?: string;
}

export interface JpkWyslijReq {
  miesiac?: string;
  kwartal?: string;
  srodowisko: string;
  celZlozenia: number;
  osobaFizyczna: boolean;
  imie?: string;
  nazwisko?: string;
  dataUrodzenia?: string;
  telefon?: string;
  kodUrzedu?: string;
  nipLubPesel?: string;
  kwotaPrzychodu: number;
  zwrotTryb: string;
}

export interface JpkWyslijWynik {
  referenceNumber: string;
  kod: number;
  opis: string;
  upo?: string | null;
  srodowisko: string;
  pominiete?: string[];
}

export interface ZusPropozycja {
  miesiac: string;
  spoleczne: number;
  zdrowotna: number;
  fp: number;
  razem: number;
  emerytalne: number;
  rentowe: number;
  chorobowe: number;
  wypadkowe: number;
  podstawaEmerytalnaRentowa: number;
  podstawaChorobowa: number;
  podstawaWypadkowa: number;
  podstawaZdrowotna: number;
  stopaWypadkowa: number;
  kodTytulu: string;
  dochodPoprzedniMiesiac: number;
  przychodYtd: number;
  uwaga: string;
}

export interface ZusKeduReq {
  miesiac: string;
  emerytalne: number;
  rentowe: number;
  chorobowe: number;
  wypadkowe: number;
  zdrowotna: number;
  fp: number;
  podstawaEmerytalnaRentowa: number;
  podstawaChorobowa: number;
  podstawaWypadkowa: number;
  podstawaZdrowotna: number;
  stopaWypadkowa: number;
  kodTytulu?: string;
  imie?: string;
  nazwisko?: string;
  dochodPoprzedniMiesiac?: number;
  przychodYtd?: number;
}
