// Klient REST do backendu .NET (Frank.Api).
// W dev Vite proxy przekazuje /api -> http://localhost:5203,
// w Dockerze ten sam origin serwuje API + statyczny frontend.

import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { PKD, RYCZALT, type PkdEntry, type RyczaltEntry } from '../../src-shared/dictionaries.js';
import { stawkiNaRok, type Rates2026 } from '../../src-shared/tax/rates2026.js';

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
    if (!res.ok) throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path}: HTTP ${res.status}`);
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
  const s = { ...(rest as object), pkd } as TaxpayerSettings;
  // Normalizacja legacy schematów ZUS (ulgowy→start, maly→maly_plus)
  if (s.zusSchemat === 'ulgowy') s.zusSchemat = 'start';
  if (s.zusSchemat === 'maly') s.zusSchemat = 'maly_plus';
  return s;
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
      ...body({ ...s, pkdJson: JSON.stringify(s.pkd ?? []) }),
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

  pkd: (): Promise<PkdEntry[]> => req<PkdEntry[]>('/slowniki/pkd').catch(() => PKD),
  ryczaltRates: (): Promise<RyczaltEntry[]> => req<RyczaltEntry[]>('/slowniki/ryczalt').catch(() => RYCZALT),
  /** Stawki roczne ZUS/limitów z API (fallback: wbudowana tabela). */
  stawki: (rok: number): Promise<Rates2026> =>
    req<{ zusDuzySpoleczne: number; zusDuzyFP: number; zusZdrowotnaMin: number; liniowyZdrowotnaLimit: number; vatLimitZwolnienia: number }>(`/slowniki/stawki?rok=${rok}`)
      .then((s) => ({
        ...stawkiNaRok(rok),
        zusDuzySpoleczne: s.zusDuzySpoleczne,
        zusDuzyFP: s.zusDuzyFP,
        zusZdrowotnaMinLiniowy: s.zusZdrowotnaMin,
        zusZdrowotnaMinRyczalt: s.zusZdrowotnaMin,
        liniowyZdrowotnaLimitRoczny: s.liniowyZdrowotnaLimit,
        vatLimitZwolnienia: s.vatLimitZwolnienia,
      }))
      .catch(() => stawkiNaRok(rok)),
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
