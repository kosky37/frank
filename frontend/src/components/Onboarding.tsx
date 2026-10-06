import { useState, type JSX } from 'react';
import type { TaxForm } from '../../src-shared/tax/types.js';
import { updateSettings, useStore } from '../lib/store.js';
import { isValidNip } from '../lib/format.js';
import { Field, Modal } from './ui.js';

export const ONBOARDING_KEY = 'frank-onboarding-done';

export function onboardingZakonczony(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

function zakoncz(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Kreator pierwszego uruchomienia: firma → opodatkowanie → ZUS → gotowe. */
export function Onboarding({ onClose, onGotoSales }: { onClose: () => void; onGotoSales: () => void }): JSX.Element {
  const { settings } = useStore();
  const [krok, setKrok] = useState(0);
  const [exPracodawca, setExPracodawca] = useState(false);

  function done(gotoSales: boolean): void {
    zakoncz();
    onClose();
    if (gotoSales) onGotoSales();
  }

  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void {
    updateSettings({ [k]: v } as Partial<typeof settings>);
  }

  const nipWarn =
    settings.firmaNip && !isValidNip(settings.firmaNip) ? 'NIP wygląda na nieprawidłowy.' : undefined;

  return (
    <Modal
      title={`Witaj we Franku (${krok + 1}/4)`}
      onClose={() => done(false)}
      foot={
        <>
          <button className="btn ghost small" onClick={() => done(false)}>
            Pomiń
          </button>
          {krok > 0 && (
            <button className="btn secondary" onClick={() => setKrok(krok - 1)}>
              Wstecz
            </button>
          )}
          {krok < 3 ? (
            <button className="btn" onClick={() => setKrok(krok + 1)}>
              Dalej
            </button>
          ) : (
            <button className="btn" onClick={() => done(true)}>
              Wystaw pierwszą fakturę →
            </button>
          )}
        </>
      }
    >
      {krok === 0 && (
        <div>
          <p>
            Frank prowadzi JDG programisty: <b>1 faktura w 60 s</b>, koszty zdjęciem paragonu,
            a co miesiąc jasne <b>ile i do kiedy</b> (PIT do 20., ZUS do 20., VAT do 25.).
          </p>
          <p className="muted">4 szybkie kroki i jesteś rozliczony. Dane trzymasz lokalnie, wysyłasz gdy chcesz.</p>
        </div>
      )}
      {krok === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nazwa firmy">
            <input
              value={settings.firmaNazwa ?? ''}
              onChange={(e) => set('firmaNazwa', e.target.value)}
              placeholder="Jan Kowalski"
            />
          </Field>
          <Field label="NIP firmy" error={nipWarn} hint="Potrzebny do JPK, KSeF i mikrorachunku.">
            <input
              value={settings.firmaNip ?? ''}
              onChange={(e) => set('firmaNip', e.target.value)}
              placeholder="10 cyfr"
              inputMode="numeric"
            />
          </Field>
          <label className="inline">
            <input type="checkbox" checked={settings.vatowiec} onChange={(e) => set('vatowiec', e.target.checked)} />
            Jestem czynnym podatnikiem VAT
          </label>
        </div>
      )}
      {krok === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Forma opodatkowania" hint="Nie wiesz? Zostaw skalę — w Podatkach porównasz wszystkie na żywych danych.">
            <select value={settings.formaOpodatkowania} onChange={(e) => set('formaOpodatkowania', e.target.value as TaxForm)}>
              <option value="skala">Zasady ogólne (skala 12%/32%)</option>
              <option value="liniowy">Liniowy 19%</option>
              <option value="ryczalt">Ryczałt (IT zwykle 12%)</option>
            </select>
          </Field>
          <Field label="Schemat ZUS" hint="Start → preferencyjny → Mały ZUS Plus → duży. Ex-pracodawca u tego samego zleceniodawcy: brak ulg.">
            <select value={settings.zusSchemat} onChange={(e) => set('zusSchemat', e.target.value as typeof settings.zusSchemat)}>
              <option value="start">Ulga na start (tylko zdrowotna, 6 mies.)</option>
              <option value="preferencyjny">Preferencyjny (24 mies.)</option>
              <option value="maly_plus">Mały ZUS Plus (36 mies.)</option>
              <option value="duzy">Duży ZUS</option>
            </select>
          </Field>
          <label className="inline" style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={exPracodawca} onChange={(e) => setExPracodawca(e.target.checked)} />
            Wcześniej etat u tego samego zleceniodawcy
          </label>
          {exPracodawca && (
            <div className="warn">
              Ex-pracodawca na B2B: brak ulgi na start i preferencyjnego + ryzyko uznania umowy za etat (PIP).
              Wybierz „Duży ZUS” i skonsultuj umowę.
            </div>
          )}
        </div>
      )}
      {krok === 3 && (
        <div>
          <p>
            Gotowe: <b>{settings.firmaNazwa || 'Twoja firma'}</b> •{' '}
            {settings.formaOpodatkowania === 'skala' ? 'skala' : settings.formaOpodatkowania} •{' '}
            {settings.vatowiec ? 'VAT-owiec' : 'zwolnienie z VAT'}.
          </p>
          <p className="muted">
            Kliknij poniżej — Frank podpowie numer faktury i skopiuje dane z poprzedniego miesiąca.
            Terminy na 2026 (KSeF od 1.04, PIT do 30 IV) masz na Pulpicie.
          </p>
        </div>
      )}
    </Modal>
  );
}
