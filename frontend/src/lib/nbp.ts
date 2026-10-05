// Kursy walut NBP (api.nbp.pl, tabela A/C, bez klucza) z 24h cache
// w localStorage + statycznym fallbackiem. Do przeliczeń VAT faktur walutowych.

export interface KursInfo {
  waluta: string;
  kurs: number;
  data: string; // yyyy-mm-dd (dzień notowania)
  zrodlo: 'nbp' | 'cache' | 'fallback';
}

/** Fallback statyczny, gdy NBP i cache niedostępne (do weryfikacji w dniu wystawienia). */
const FALLBACK: Record<string, number> = {
  EUR: 4.32,
  USD: 4.05,
  CHF: 4.58,
  GBP: 5.05,
};

const TTL_MS = 24 * 3600 * 1000;

function kluczCache(w: string, dzien: string): string {
  return `frank-nbp-${w}-${dzien}`;
}

function czytajCache(w: string, dzien: string): KursInfo | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(kluczCache(w, dzien));
    if (!raw) return null;
    const j = JSON.parse(raw) as { kurs: number; data: string; ts: number };
    if (typeof j.kurs !== 'number' || Date.now() - j.ts > TTL_MS) return null;
    return { waluta: w, kurs: j.kurs, data: j.data, zrodlo: 'cache' };
  } catch {
    return null;
  }
}

function zapiszCache(info: KursInfo): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      kluczCache(info.waluta, info.data),
      JSON.stringify({ kurs: info.kurs, data: info.data, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

interface NbpRate {
  mid?: number;
  bid?: number;
  ask?: number;
  effectiveDate?: string;
}

/** Próba pobrania kursu z NBP: tabela A (mid), potem C (średnia bid/ask). */
async function zNbp(w: string, dzien?: string): Promise<{ kurs: number; data: string } | null> {
  for (const tabela of ['a', 'c']) {
    try {
      const url = dzien
        ? `https://api.nbp.pl/api/exchangerates/rates/${tabela}/${w}/${dzien}/?format=json`
        : `https://api.nbp.pl/api/exchangerates/rates/${tabela}/${w}/?format=json`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue; // 404 w weekendy/święta — próbuj dalej
      const j = (await res.json()) as { rates?: NbpRate[] };
      const r = j.rates?.[0];
      if (!r) continue;
      const data = r.effectiveDate ?? dzien ?? new Date().toISOString().slice(0, 10);
      if (typeof r.mid === 'number') return { kurs: r.mid, data };
      if (typeof r.bid === 'number' && typeof r.ask === 'number') {
        return { kurs: Math.round(((r.bid + r.ask) / 2 + Number.EPSILON) * 100) / 100, data };
      }
    } catch {
      /* następna tabela / fallback */
    }
  }
  return null;
}

/**
 * Kurs waluty do PLN. `dataISO` = dzień wystawienia (NBP: tabela z dnia
 * roboczego poprzedzającego — odlicz dzień sam w fakturze, tu 1:1).
 */
export async function pobierzKurs(waluta: string, dataISO?: string): Promise<KursInfo> {
  const w = waluta.trim().toUpperCase();
  const dzien = dataISO ?? new Date().toISOString().slice(0, 10);
  if (w === '' || w === 'PLN') return { waluta: 'PLN', kurs: 1, data: dzien, zrodlo: 'nbp' };
  const cached = czytajCache(w, dzien);
  if (cached) return cached;
  const zDnia = await zNbp(w, dzien);
  if (zDnia) {
    const info: KursInfo = { waluta: w, kurs: zDnia.kurs, data: zDnia.data, zrodlo: 'nbp' };
    zapiszCache(info);
    return info;
  }
  const ostatni = await zNbp(w); // ostatnie notowanie (weekend/święto)
  if (ostatni) {
    const info: KursInfo = { waluta: w, kurs: ostatni.kurs, data: ostatni.data, zrodlo: 'nbp' };
    zapiszCache(info);
    return info;
  }
  const fb = FALLBACK[w];
  if (fb !== undefined) return { waluta: w, kurs: fb, data: dzien, zrodlo: 'fallback' };
  throw new Error(`Brak kursu ${w} (NBP niedostępny, brak fallbacku).`);
}
