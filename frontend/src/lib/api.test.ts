import { describe, expect, it } from 'vitest';
import { mapSettingsIn } from './api.js';

describe('mapSettingsIn', () => {
  it('parsuje pkdJson do tablicy', () => {
    const s = mapSettingsIn({ formaOpodatkowania: 'liniowy', pkdJson: '["62.01.Z","62.09.Z"]' });
    expect(s.pkd).toEqual(['62.01.Z', '62.09.Z']);
    expect(s.formaOpodatkowania).toBe('liniowy');
  });
  it('niepoprawny JSON daje undefined', () => {
    const s = mapSettingsIn({ pkdJson: 'nie-json' });
    expect(s.pkd).toBeUndefined();
  });
});
