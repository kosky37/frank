import { describe, expect, it } from 'vitest';
import { fmtMoney, formatDataPL } from './format.js';
import { mapSettingsIn } from './api.js';
import { DEFAULT_SETTINGS } from '../../src-shared/tax/rates2026.js';
import { parseBankCsv } from '../components/Costs.js';
import { porownajPelneObciazenie } from '../../src-shared/tax/pit.js';
import { rocznyZusForma } from '../../src-shared/tax/zus.js';

describe('audyt 2026-10-06: NaN i formaty', () => {
  it('fmtMoney guarduje NaN/undefined', () => {
    expect(fmtMoney(NaN)).toBe('—');
    expect(fmtMoney(Infinity)).toBe('—');
    expect(fmtMoney(20000)).toContain('20');
  });
  it('formatDataPL konwertuje ISO na PL', () => {
    expect(formatDataPL('2026-10-20')).toBe('20.10.2026');
    expect(formatDataPL('2026-02-14')).toBe('14.02.2026');
    expect(formatDataPL('brak')).toBe('brak');
  });
  it('mapSettingsIn normalizuje zusFpMies -> zusFPMies', () => {
    const s = mapSettingsIn({
      ...DEFAULT_SETTINGS,
      zusFpMies: 138.47,
      zusFPMies: undefined,
    } as unknown as Record<string, unknown>);
    expect(s.zusFPMies).toBe(138.47);
  });
  it('mapSettingsIn daje default przy braku FP', () => {
    const { zusFpMies: _a, zusFPMies: _b, ...rest } = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    void _a; void _b;
    const s = mapSettingsIn(rest);
    expect(s.zusFPMies).toBe(DEFAULT_SETTINGS.zusFPMies);
  });
  it('parseBankCsv bierze wydatki, pomija wpływy', () => {
    const rows = parseBankCsv('2026-01-10;ORLEN paliwo;-250,50\n2026-01-11;Klient zapłata;20000\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].netto).toBeCloseTo(250.5, 2);
    expect(rows[0].wystawca).toContain('ORLEN');
  });
  it('rocznyZusForma skaluje się do YTD (1 mies. < 12 mies.)', () => {
    const ytd1 = rocznyZusForma('liniowy', 12000, 18000, 1788.29, 138.47, 432.54, false, 1);
    const full = rocznyZusForma('liniowy', 12000, 18000, 1788.29, 138.47, 432.54, false, 12);
    expect(ytd1.spoleczne).toBeCloseTo(1788.29, 2);
    expect(full.spoleczne).toBeCloseTo(1788.29 * 12, 2);
    expect(ytd1.razem).toBeLessThan(full.razem);
  });
  it('porownajPelneObciazenie YTD daje niezerowy PIT przy 1 mies. danych', () => {
    const wynik = porownajPelneObciazenie({
      przychod: 20000, koszty: 5750,
      zusSpoleczneMies: 1788.29, zusFPMies: 138.47, zdrowMinMies: 432.54,
      stawkaRyczaltu: 0.12, wakacje: false, miesiace: 1,
    });
    expect(wynik.liniowy.pit).toBeGreaterThan(0);
    expect(wynik.liniowy.zus).toBeLessThan(30000);
  });
});
