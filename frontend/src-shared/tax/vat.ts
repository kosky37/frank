import type { CostInvoice, SalesInvoice, VatRate, VehicleUsage } from './types.js';
import { RATES_2026 } from './rates2026.js';

export function vatRateToNumber(r: VatRate): number {
  if (typeof r === 'number') return r;
  return 0; // zw / np / oo => 0 należnego
}

export function vatForNetto(netto: number, stawka: VatRate): { vat: number; brutto: number } {
  const s = vatRateToNumber(stawka);
  const vat = round2(netto * s);
  return { vat, brutto: round2(netto + vat) };
}

export function round2(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Korekta VAT naliczonego dla kosztów pojazdowych. */
export function deductibleVatCost(c: CostInvoice): number {
  if (c.nieodliczalnyArt23) return 0;
  const { vat } = vatForNetto(c.netto, c.stawkaVat);
  if (typeof c.vatNaliczonyDowolny === 'number') return round2(c.vatNaliczonyDowolny);
  if (!c.pojazdowy) return vat;
  if (c.uzytkowaniePojazdu === 'mieszany') return round2(vat * RATES_2026.pojazdMieszanyVat);
  if (c.uzytkowaniePojazdu === 'wylacznie_firma') return vat; // wymaga VAT-26, weryfikowane w UI
  return 0; // pojazd prywatny
}

/** Korekta kosztu PIT dla wydatków pojazdowych. */
export function deductibleCostPit(c: CostInvoice): number {
  if (c.nieodliczalnyArt23) return 0;
  if (!c.pojazdowy) return round2(c.netto);
  const use: VehicleUsage = c.uzytkowaniePojazdu;
  if (use === 'mieszany') return round2(c.netto * RATES_2026.pojazdMieszanyPit);
  if (use === 'wylacznie_firma') return round2(c.netto);
  return 0;
}

export function salesVat(invoice: SalesInvoice): { netto: number; vat: number; brutto: number } {
  let netto = 0;
  let vat = 0;
  for (const p of invoice.pozycje) {
    const ln = round2(p.ilosc * p.cenaNetto);
    netto += ln;
    vat += vatForNetto(ln, p.stawkaVat).vat;
  }
  netto = round2(netto);
  vat = round2(vat);
  return { netto, vat, brutto: round2(netto + vat) };
}

/** VAT do zapłaty / zwrotu: należny - naliczony (nie mniej niż... zwrot obsługuje UI). */
export function vatDue(vatNalezny: number, vatNaliczony: number): number {
  return round2(vatNalezny - vatNaliczony);
}

/** Licznik limitu zwolnienia VAT 240k (2026). Zwraca ułamek wykorzystania 0..1+. */
export function vatLimitUzycie(przychodYtdNetto: number): { limit: number; uzycie: number; przekroczony: boolean } {
  const limit = RATES_2026.vatLimitZwolnienia;
  return {
    limit,
    uzycie: limit ? przychodYtdNetto / limit : 0,
    przekroczony: przychodYtdNetto > limit,
  };
}

/** MPP: obowiązkowy gdy B2B + brutto >15k + pozycja z zał. 15. Tu: heurystyka — flaga z faktury. */
export function czyMppWymagany(brutto: number, maPozycjeZal15 = false): boolean {
  return brutto > 15000 && maPozycjeZal15;
}
