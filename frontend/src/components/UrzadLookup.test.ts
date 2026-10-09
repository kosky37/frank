import { describe, expect, it } from 'vitest';
import { filtrujUrzedy } from './UrzadLookup.js';
import type { UrzadSk } from '../lib/api.js';

// Kolejność jak w pliku MF (Wałbrzych 0222 przed Warszawą 1431) — ranking ma to naprawić.
const MF: UrzadSk[] = [
  { kod: '0222', nazwa: 'URZĄD SKARBOWY W WAŁBRZYCHU' },
  { kod: '0419', nazwa: 'URZĄD SKARBOWY W WĄBRZEŹNIE' },
  { kod: '0616', nazwa: 'URZĄD SKARBOWY W PUŁAWACH' },
  { kod: '1008', nazwa: 'PIERWSZY URZĄD SKARBOWY ŁÓDŹ-BAŁUTY' },
  { kod: '1431', nazwa: 'URZĄD SKARBOWY WARSZAWA-BEMOWO' },
  { kod: '1435', nazwa: 'PIERWSZY URZĄD SKARBOWY WARSZAWA-ŚRÓDMIEŚCIE' },
];

describe('filtrujUrzedy', () => {
  it('wa → WARSZAWA przed Wałbrzychem (ranking pozycją, nie kolejnością pliku)', () => {
    const w = filtrujUrzedy(MF, 'wa');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].kod).toBe('1431');
    expect(w.some((u) => u.kod === '1435')).toBe(true);
  });

  it('kod od początku wygrywa z nazwą', () => {
    expect(filtrujUrzedy(MF, '1435')[0].kod).toBe('1435');
  });

  it('bez polskich znaków: lodz → ŁÓDŹ, wabrzeznie → WĄBRZEŹNO', () => {
    expect(filtrujUrzedy(MF, 'lodz')[0].kod).toBe('1008');
    expect(filtrujUrzedy(MF, 'wabrzeznie')[0].kod).toBe('0419');
  });

  it('puste / brak trafień', () => {
    expect(filtrujUrzedy(MF, '')).toEqual([]);
    expect(filtrujUrzedy(MF, 'xyznieistnieje')).toEqual([]);
  });

  it('limit obcina od najsłabszych', () => {
    const w = filtrujUrzedy(MF, 'wa', 2);
    expect(w).toHaveLength(2);
    expect(w[0].kod).toBe('1431');
  });
});
