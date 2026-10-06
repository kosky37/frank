import { describe, expect, it } from 'vitest';
import { kwotaSlownie, liczbaSlownie } from './slownie.js';

describe('kwota słownie', () => {
  it('liczby', () => {
    expect(liczbaSlownie(0)).toBe('zero');
    expect(liczbaSlownie(12)).toBe('dwanaście');
    expect(liczbaSlownie(1000)).toBe('tysiąc');
    expect(liczbaSlownie(2024)).toBe('dwa tysiące dwadzieścia cztery');
    expect(liczbaSlownie(15000)).toBe('piętnaście tysięcy');
    expect(liczbaSlownie(1_234_567)).toBe('milion dwieście trzydzieści cztery tysiące pięćset sześćdziesiąt siedem');
    expect(liczbaSlownie(22_000)).toBe('dwadzieścia dwa tysiące');
  });
  it('kwoty z walutą i groszami', () => {
    expect(kwotaSlownie(24600)).toBe('dwadzieścia cztery tysiące sześćset złotych 00/100');
    expect(kwotaSlownie(1.5)).toBe('jeden złoty 50/100');
    expect(kwotaSlownie(3.07)).toBe('trzy złote 07/100');
    expect(kwotaSlownie(5000, 'EUR')).toBe('pięć tysięcy euro 00/100');
  });
});
