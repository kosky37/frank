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

/** Korekta VAT naliczonego dla kosztów pojazdowych. Nievatowiec nie odlicza nic. */
export function deductibleVatCost(c: CostInvoice, vatowiec = true): number {
  if (!vatowiec || c.nieodliczalnyArt23) return 0;
  const { vat } = vatForNetto(c.netto, c.stawkaVat);
  if (typeof c.vatNaliczonyDowolny === 'number') return round2(c.vatNaliczonyDowolny);
  if (!c.pojazdowy) return vat;
  if (c.uzytkowaniePojazdu === 'mieszany') return round2(vat * RATES_2026.pojazdMieszanyVat);
  if (c.uzytkowaniePojazdu === 'wylacznie_firma') return vat; // wymaga VAT-26, weryfikowane w UI
  return 0; // pojazd prywatny
}

/**
 * Koszt PIT: netto + VAT, którego nie odliczono (art. 23 ust. 1 pkt 43 lit. a — nieodliczony VAT jest kosztem).
 * Pojazd mieszany: 75% z tej sumy.
 */
export function deductibleCostPit(c: CostInvoice, vatowiec = true): number {
  if (c.nieodliczalnyArt23) return 0;
  const use: VehicleUsage = c.uzytkowaniePojazdu;
  if (c.pojazdowy && use === 'prywatny') return 0;
  const { vat } = vatForNetto(c.netto, c.stawkaVat);
  const nieodliczony = Math.max(0, round2(vat - deductibleVatCost(c, vatowiec)));
  const base = round2(c.netto + nieodliczony);
  if (c.pojazdowy && use === 'mieszany') return round2(base * RATES_2026.pojazdMieszanyPit);
  return base;
}

/** Faktyczny wydatek gotówkowy kosztu (brutto minus odzyskany VAT) — do „na rękę”. */
export function costCashOut(c: CostInvoice, vatowiec = true): number {
  const { brutto } = vatForNetto(c.netto, c.stawkaVat);
  return round2(brutto - deductibleVatCost(c, vatowiec));
}

/** Kurs przeliczenia faktury na PLN (1 dla PLN lub brak kursu). */
export function kursFaktury(invoice: SalesInvoice): number {
  const w = (invoice.waluta ?? 'PLN').toUpperCase();
  if (w === 'PLN') return 1;
  return typeof invoice.kursNbp === 'number' && invoice.kursNbp > 0 ? invoice.kursNbp : 1;
}

/** Czy faktura walutowa nie ma kursu NBP (kwoty w PLN będą błędne). */
export function brakKursu(invoice: SalesInvoice): boolean {
  const w = (invoice.waluta ?? 'PLN').toUpperCase();
  return w !== 'PLN' && !(typeof invoice.kursNbp === 'number' && invoice.kursNbp > 0);
}

/** Sumy faktury w PLN: netto pozycji × kurs NBP, VAT liczony od podstawy w PLN (art. 31a). */
export function salesVatPln(invoice: SalesInvoice): { netto: number; vat: number; brutto: number } {
  const kurs = kursFaktury(invoice);
  if (kurs === 1) return salesVat(invoice);
  let netto = 0;
  let vat = 0;
  for (const p of invoice.pozycje) {
    const ln = round2(round2(p.ilosc * p.cenaNetto) * kurs);
    netto += ln;
    vat += vatForNetto(ln, p.stawkaVat).vat;
  }
  netto = round2(netto);
  vat = round2(vat);
  return { netto, vat, brutto: round2(netto + vat) };
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
