import { useSyncExternalStore } from 'react';
import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { DEFAULT_SETTINGS } from '../../src-shared/tax/rates2026.js';
import { api, type ContractorFull } from './api.js';
import { toast } from '../components/ui.js';

export interface Store {
  sales: SalesInvoice[];
  costs: CostInvoice[];
  settings: TaxpayerSettings;
  contractors: ContractorFull[];
}

export type BackendStatus = 'unknown' | 'online' | 'local';

const KEY = 'frank-jdg-v1';

function demoState(): Store {
  return {
    sales: [
      {
        id: 'demo1',
        numer: '1/01/2026',
        kontrahent: { id: 'k1', nazwa: 'Acme Sp. z o.o.', nip: '5250000000', adres: 'Warszawa' },
        dataWystawienia: '2026-01-31',
        dataSprzedazy: '2026-01-31',
        terminPlatnosci: '2026-02-14',
        pozycje: [{ nazwa: 'Usługi programistyczne 01/2026', ilosc: 1, cenaNetto: 20000, stawkaVat: 0.23, stawkaRyczaltu: 0.12 }],
        status: 'wystawiona',
        zaplacona: true,
      },
    ],
    costs: [
      {
        id: 'demo-c1',
        numer: 'FV/ORLEN/1',
        wystawca: 'Orlen',
        dataZakupu: '2026-01-10',
        dataKsiegowania: '2026-01-10',
        kategoria: 'paliwo',
        pojazdowy: true,
        uzytkowaniePojazdu: 'mieszany',
        netto: 1000,
        stawkaVat: 0.23,
        opis: 'paliwo — mix 50% VAT / 75% PIT',
      },
      {
        id: 'demo-c2',
        numer: 'FV/COMPUTRONIK/2',
        wystawca: 'Komputronik',
        dataZakupu: '2026-01-12',
        dataKsiegowania: '2026-01-12',
        kategoria: 'sprzet',
        pojazdowy: false,
        uzytkowaniePojazdu: 'mieszany',
        netto: 5000,
        stawkaVat: 0.23,
        opis: 'dysk SSD + RAM',
      },
    ],
    settings: DEFAULT_SETTINGS,
    contractors: [],
  };
}

function normalizeSettings(s: TaxpayerSettings): TaxpayerSettings {
  const raw = s as TaxpayerSettings & Record<string, unknown>;
  const fpLegacy = raw['zusFpMies'];
  let zusFPMies = s.zusFPMies;
  if ((zusFPMies === undefined || zusFPMies === null || !Number.isFinite(zusFPMies)) && typeof fpLegacy === 'number' && Number.isFinite(fpLegacy)) {
    zusFPMies = fpLegacy;
  }
  if (!Number.isFinite(zusFPMies)) zusFPMies = DEFAULT_SETTINGS.zusFPMies;
  const zusSpoleczneMies = Number.isFinite(s.zusSpoleczneMies) ? s.zusSpoleczneMies : DEFAULT_SETTINGS.zusSpoleczneMies;
  const zusZdrowotnaMies = Number.isFinite(s.zusZdrowotnaMies) ? s.zusZdrowotnaMies : DEFAULT_SETTINGS.zusZdrowotnaMies;
  return { ...s, zusFPMies, zusSpoleczneMies, zusZdrowotnaMies };
}

function loadLocal(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Store;
      return {
        sales: p.sales ?? [],
        costs: p.costs ?? [],
        settings: normalizeSettings(p.settings ?? DEFAULT_SETTINGS),
        contractors: p.contractors ?? [],
      };
    }
  } catch {
    /* ignore */
  }
  return demoState();
}

let state: Store =
  typeof localStorage !== 'undefined'
    ? loadLocal()
    : { sales: [], costs: [], settings: DEFAULT_SETTINGS, contractors: [] };
let backend: BackendStatus = 'unknown';
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Start: próba pobrania stanu z API, fallback do localStorage. */
export async function initStore(): Promise<BackendStatus> {
  try {
    const [sales, costs, settings, contractors] = await Promise.all([
      api.sales(),
      api.costs(),
      api.settings(),
      api.contractors(),
    ]);
    state = { sales, costs, settings, contractors };
    backend = 'online';
  } catch {
    state = loadLocal();
    backend = 'local';
  }
  persist();
  emit();
  return backend;
}

export function getStore(): Store {
  return state;
}

export function useStore(): Store {
  return useSyncExternalStore(subscribe, getStore, getStore);
}

export function getBackend(): BackendStatus {
  return backend;
}

export function useBackend(): BackendStatus {
  return useSyncExternalStore(subscribe, getBackend, getBackend);
}

function sync(fn: () => Promise<unknown>): void {
  if (backend !== 'online') return;
  void fn().catch((e: unknown) => {
    console.warn('sync API failed:', e);
    toast(`Nie zapisano na serwerze: ${e instanceof Error ? e.message : 'błąd API'} (dane zostały lokalnie)`, 'err');
  });
}

// --- wybrany rok rozliczeniowy (wspólny dla Pulpitu, Podatków i Terminów) ---

const ROK_KEY = 'frank-rok';
let rokWybrany = (() => {
  const teraz = new Date().getFullYear();
  try {
    const v = Number(localStorage.getItem(ROK_KEY));
    return v >= 2020 && v <= teraz + 1 ? v : teraz;
  } catch {
    return teraz;
  }
})();
const rokListeners = new Set<() => void>();

export function ustawRok(rok: number): void {
  rokWybrany = rok;
  try {
    localStorage.setItem(ROK_KEY, String(rok));
  } catch {
    /* ignore */
  }
  rokListeners.forEach((l) => l());
}

export function useRok(): number {
  return useSyncExternalStore(
    (fn) => {
      rokListeners.add(fn);
      return () => rokListeners.delete(fn);
    },
    () => rokWybrany,
    () => rokWybrany,
  );
}

/** Lata do wyboru: od najstarszego dokumentu do bieżącego. */
export function dostepneLata(s: Store): number[] {
  const teraz = new Date().getFullYear();
  let min = teraz;
  for (const x of s.sales) min = Math.min(min, Number(x.dataSprzedazy.slice(0, 4)) || teraz);
  for (const x of s.costs) min = Math.min(min, Number(x.dataKsiegowania.slice(0, 4)) || teraz);
  const out: number[] = [];
  for (let r = teraz; r >= Math.max(2020, min); r--) out.push(r);
  return out;
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;

export function addSale(inv: SalesInvoice): void {
  state = { ...state, sales: [...state.sales, inv] };
  persist();
  emit();
  sync(() => api.addSale(inv));
}

export function removeSale(id: string): void {
  state = { ...state, sales: state.sales.filter((x) => x.id !== id) };
  persist();
  emit();
  sync(() => api.deleteSale(id));
}

export function updateSale(inv: SalesInvoice): void {
  state = { ...state, sales: state.sales.map((x) => (x.id === inv.id ? inv : x)) };
  persist();
  emit();
  sync(() => api.updateSale(inv));
}

export function addCost(c: CostInvoice): void {
  state = { ...state, costs: [...state.costs, c] };
  persist();
  emit();
  sync(() => api.addCost(c));
}

export function removeCost(id: string): void {
  state = { ...state, costs: state.costs.filter((x) => x.id !== id) };
  persist();
  emit();
  sync(() => api.deleteCost(id));
}

export function updateCost(c: CostInvoice): void {
  state = { ...state, costs: state.costs.map((x) => (x.id === c.id ? c : x)) };
  persist();
  emit();
  sync(() => api.updateCost(c));
}

export function addContractor(c: ContractorFull): void {
  state = { ...state, contractors: [...state.contractors, c].sort((a, b) => a.nazwa.localeCompare(b.nazwa)) };
  persist();
  emit();
  sync(() => api.addContractor(c));
}

export function updateContractor(c: ContractorFull): void {
  state = { ...state, contractors: state.contractors.map((x) => (x.id === c.id ? c : x)) };
  persist();
  emit();
  sync(() => api.updateContractor(c));
}

export function removeContractor(id: string): void {
  state = { ...state, contractors: state.contractors.filter((x) => x.id !== id) };
  persist();
  emit();
  sync(() => api.deleteContractor(id));
}

export function updateSettings(patch: Partial<TaxpayerSettings>): void {
  state = { ...state, settings: { ...state.settings, ...patch } };
  persist();
  emit();
  if (backend !== 'online') return;
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    void api.saveSettings(state.settings).catch((e: unknown) => {
      console.warn('sync settings failed:', e);
      toast(`Ustawienia nie zapisały się na serwerze: ${e instanceof Error ? e.message : 'błąd API'}`, 'err');
    });
  }, 400);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Nadpisanie całego stanu (przywracanie backupu 1-klik). */
export function replaceStore(next: Store): void {
  state = {
    sales: next.sales ?? [],
    costs: next.costs ?? [],
    settings: next.settings ?? state.settings,
    contractors: next.contractors ?? [],
  };
  persist();
  emit();
  if (backend !== 'online') return;
  void api.saveSettings(state.settings).catch((e) => console.warn('sync settings failed:', e));
}
