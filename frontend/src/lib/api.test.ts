import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, mapSettingsIn } from './api.js';

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

describe('req błędy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('dołącza message backendu do ApiError (zamiast gołego HTTP 400)', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ code: 'BRAK_NIP', message: 'Uzupełnij NIP firmy' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const err = await api.ksef.sprawdz().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as Error).message).toContain('Uzupełnij NIP firmy');
  });
  it('pusty body nie psuje ApiError', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(api.ksef.sprawdz()).rejects.toThrow(/HTTP 500/);
  });
});
