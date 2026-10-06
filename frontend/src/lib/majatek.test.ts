// Majątek: limity aut 2026, amortyzacja, ewidencja przebiegu.
import { describe, expect, it } from 'vitest';
import { ewidencjaCsv, limitAuta, odpisZaRok, sumaKm } from './majatek.js';

describe('limitAuta 2026', () => {
  it('EV 225k / <50g 150k / spal. 100k', () => {
    expect(limitAuta('ev', 300000, 2026).limit).toBe(225000);
    expect(limitAuta('ev', 300000, 2026).nadwyzka).toBe(75000);
    expect(limitAuta('niskoemisyjne', 200000, 2026).odliczalne).toBe(150000);
    expect(limitAuta('spalinowe', 120000, 2026).odliczalne).toBe(100000);
    expect(limitAuta('spalinowe', 80000, 2026).nadwyzka).toBe(0);
  });
  it('auta sprzed 2026: 150k / 225k', () => {
    expect(limitAuta('spalinowe', 200000, 2024).limit).toBe(150000);
    expect(limitAuta('ev', 300000, 2025).limit).toBe(225000);
  });
});

describe('odpisZaRok', () => {
  it('jednorazowa: 100% w roku nabycia', () => {
    const s = { id: 'x', nazwa: 'Laptop', wartosc: 12000, dataNabycia: '2026-03-01', metoda: 'jednorazowa' as const };
    expect(odpisZaRok(s, 2026).odpis).toBe(12000);
    expect(odpisZaRok(s, 2027, 12000).odpis).toBe(0);
    expect(odpisZaRok(s, 2025).odpis).toBe(0);
  });
  it('liniowa 20%: 5 lat do zera', () => {
    const s = { id: 'x', nazwa: 'Laptop', wartosc: 10000, dataNabycia: '2026-01-15', metoda: 'liniowa' as const, stawkaRoczna: 20 };
    const r1 = odpisZaRok(s, 2026);
    expect(r1.odpis).toBe(2000);
    expect(r1.wartoscNetto).toBe(8000);
    const r5 = odpisZaRok(s, 2030, 8000);
    expect(r5.odpis).toBe(2000);
    expect(r5.wartoscNetto).toBe(0);
  });
});

describe('ewidencja przebiegu', () => {
  it('suma km + CSV sortowane po dacie', () => {
    const wpisy = [
      { id: '2', data: '2026-02-01', trasa: 'Gdańsk–Warszawa', km: 340, cel: 'klient' },
      { id: '1', data: '2026-01-05', trasa: 'Gdańsk', km: 12, cel: 'biuro' },
    ];
    expect(sumaKm(wpisy)).toBe(352);
    const csv = ewidencjaCsv(wpisy);
    expect(csv.startsWith('data;trasa;km;cel\n')).toBe(true);
    expect(csv.indexOf('2026-01-05')).toBeLessThan(csv.indexOf('2026-02-01'));
  });
});
