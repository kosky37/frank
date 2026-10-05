import { useState, type JSX } from 'react';
import type { TaxForm } from '../../src-shared/tax/types.js';
import { PKD, RYCZALT } from '../../src-shared/dictionaries.js';
import { zusKodTytulu } from '../../src-shared/tax/zus.js';
import { updateSettings, useStore } from '../lib/store.js';
import { isValidNip } from '../lib/format.js';
import { RegistrySearch } from './Contractors.js';
import { Field } from './ui.js';

export function SettingsTab(): JSX.Element {
  const { settings } = useStore();
  const [showRates, setShowRates] = useState(false);
  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void {
    updateSettings({ [k]: v } as Partial<typeof settings>);
  }
  function togglePkd(kod: string): void {
    const cur = settings.pkd ?? [];
    set('pkd', cur.includes(kod) ? cur.filter((x) => x !== kod) : [...cur, kod]);
  }
  const nipWarn =
    settings.firmaNip && !isValidNip(settings.firmaNip) ? 'NIP firmy wygląda na nieprawidłowy.' : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Ustawienia</h2>
          <p>Firma, forma opodatkowania, pojazd i składki — przeliczane na żywo w całej aplikacji.</p>
        </div>
      </div>
      <div className="sections">
        <div className="card">
          <h3>Moja firma (sprzedawca)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nazwa firmy">
              <input value={settings.firmaNazwa ?? ''} onChange={(e) => set('firmaNazwa', e.target.value)} placeholder="Jan Kowalski / Foo Sp. z o.o." />
            </Field>
            <Field label="NIP firmy" error={nipWarn}>
              <input value={settings.firmaNip ?? ''} onChange={(e) => set('firmaNip', e.target.value)} placeholder="10 cyfr" inputMode="numeric" />
            </Field>
            <RegistrySearch
              nip={settings.firmaNip ?? ''}
              onFill={(s) => {
                updateSettings({
                  firmaNazwa: s.nazwa,
                  firmaNip: s.nip,
                  firmaRegon: s.regon ?? settings.firmaRegon,
                  firmaAdres: s.adres || settings.firmaAdres,
                  firmaEmail: s.email ?? settings.firmaEmail,
                });
              }}
            />
            <div className="row">
              <Field label="REGON">
                <input value={settings.firmaRegon ?? ''} onChange={(e) => set('firmaRegon', e.target.value)} placeholder="9 lub 14 cyfr" />
              </Field>
              <Field label="Telefon">
                <input value={settings.firmaTelefon ?? ''} onChange={(e) => set('firmaTelefon', e.target.value)} placeholder="+48 …" />
              </Field>
            </div>
            <Field label="Adres">
              <input value={settings.firmaAdres ?? ''} onChange={(e) => set('firmaAdres', e.target.value)} placeholder="ulica, kod, miasto" />
            </Field>
            <Field label="E-mail">
              <input value={settings.firmaEmail ?? ''} onChange={(e) => set('firmaEmail', e.target.value)} placeholder="kontakt@firma.pl" />
            </Field>
            <Field
              label="Kody PKD (CEIDG)"
              hint="Do informacji — stawkę ryczałtu wyznacza PKWiU usługi, nie PKD."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                {PKD.map((p) => (
                  <label key={p.kod} className="inline" style={{ fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={(settings.pkd ?? []).includes(p.kod)}
                      onChange={() => togglePkd(p.kod)}
                    />
                    <span><b>{p.kod}</b> — {p.nazwa}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>
        <div className="card">
          <h3>Opodatkowanie (2026)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Forma opodatkowania">
              <select value={settings.formaOpodatkowania} onChange={(e) => set('formaOpodatkowania', e.target.value as TaxForm)}>
                <option value="skala">Zasady ogólne (skala 12%/32%)</option>
                <option value="liniowy">Liniowy 19%</option>
                <option value="ryczalt">Ryczałt ewidencjonowany</option>
              </select>
            </Field>
            <Field label="Domyślna stawka ryczałtu" hint="Per pozycja faktury można wybrać inną — PIT dzieli ZUS proporcjonalnie.">
              <select value={String(settings.stawkaRyczaltu)} onChange={(e) => set('stawkaRyczaltu', Number(e.target.value))}>
                {RYCZALT.map((o) => (
                  <option key={o.stawka} value={String(o.stawka)}>
                    {(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}% — {o.tytul}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <button className="btn ghost small" onClick={() => setShowRates(!showRates)}>
                {showRates ? 'Ukryj tabelę stawek' : 'Pokaż tabelę 10 stawek ryczałtu'}
              </button>
            </div>
            {showRates && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Stawka</th><th>Zakres</th></tr></thead>
                  <tbody>
                    {RYCZALT.map((o) => (
                      <tr key={o.stawka}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <b>{(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}%</b>
                          <div className="muted">{o.tytul}</div>
                        </td>
                        <td>
                          {o.zakres}
                          <div className="muted">np. {o.przyklady}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted">
              Stawkę wyznacza PKWiU usługi (art. 12 ust. 1 ustawy o zryczałtowanym PIT), nie sam PKD.
              Bez ewidencji przychodów wg stawek urząd przyjmie min. 8,5%.
            </p>
            <label className="inline">
              <input type="checkbox" checked={settings.vatowiec} onChange={(e) => set('vatowiec', e.target.checked)} />
              Czynny podatnik VAT
            </label>
            <div className="row">
              <Field label="Rozliczenie VAT">
                <select value={settings.okresVat} onChange={(e) => set('okresVat', e.target.value as typeof settings.okresVat)}>
                  <option value="miesieczny">Miesięczne (JPK_V7M, do 25.)</option>
                  <option value="kwartalny">Kwartalne (JPK_V7K, do 25. po kwartale)</option>
                </select>
              </Field>
              <Field label="Zaliczka PIT">
                <select value={settings.zaliczkaPit} onChange={(e) => set('zaliczkaPit', e.target.value as typeof settings.zaliczkaPit)}>
                  <option value="miesieczna">Miesięczna (do 20.)</option>
                  <option value="kwartalna">Kwartalna (do 20. po kwartale)</option>
                </select>
              </Field>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Pojazd</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Użytkowanie pojazdu" hint="Mieszane: 50% VAT i 75% kosztu w PIT.">
              <select value={settings.uzytkowaniePojazdu} onChange={(e) => set('uzytkowaniePojazdu', e.target.value as typeof settings.uzytkowaniePojazdu)}>
                <option value="mieszany">Mieszane (50% VAT, 75% PIT)</option>
                <option value="wylacznie_firma">Wyłącznie firma (100%, wymaga VAT-26)</option>
                <option value="prywatny">Prywatny (0%)</option>
              </select>
            </Field>
            <label className="inline">
              <input type="checkbox" checked={settings.vat26Zgloszony} onChange={(e) => set('vat26Zgloszony', e.target.checked)} />
              VAT-26 zgłoszony do urzędu
            </label>
          </div>
        </div>
        <div className="card">
          <h3>ZUS / miesiąc (zł)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Składki społeczne">
              <input type="number" min={0} step="any" value={settings.zusSpoleczneMies} onChange={(e) => set('zusSpoleczneMies', Number(e.target.value))} />
            </Field>
            <Field label="Składka zdrowotna">
              <input type="number" min={0} step="any" value={settings.zusZdrowotnaMies} onChange={(e) => set('zusZdrowotnaMies', Number(e.target.value))} />
            </Field>
            <Field label="Fundusz Pracy">
              <input type="number" min={0} step="any" value={settings.zusFPMies} onChange={(e) => set('zusFPMies', Number(e.target.value))} />
            </Field>
            <Field
              label="Schemat ZUS"
              hint="start: tylko zdrowotna 6 mies. • preferencyjny: ~456,18 bez FP 24 mies. • mały plus: podstawa od dochodu 36 mies./60 mies. • duży: 1 926,76"
            >
              <select value={settings.zusSchemat} onChange={(e) => set('zusSchemat', e.target.value as typeof settings.zusSchemat)}>
                <option value="start">Ulga na start (tylko zdrowotna, 6 mies.)</option>
                <option value="preferencyjny">Preferencyjny (~456,18 bez FP, 24 mies.)</option>
                <option value="maly_plus">Mały ZUS Plus (od dochodu, 36 mies./60 mies.)</option>
                <option value="duzy">Duży ZUS (1 926,76)</option>
                {(settings.zusSchemat === 'ulgowy' || settings.zusSchemat === 'maly') && (
                  <option value={settings.zusSchemat}>Zachowane (starsze): {settings.zusSchemat}</option>
                )}
              </select>
            </Field>
            <div className="muted">
              Kod tytułu do DRA (auto): <b>{zusKodTytulu(settings.zusSchemat)}</b>
              {settings.zusKodTytulu && settings.zusKodTytulu !== zusKodTytulu(settings.zusSchemat)
                ? ` • zapisany: ${settings.zusKodTytulu}`
                : ''}
            </div>
            <Field label="Data rozpoczęcia działalności" hint="Do liczenia ulg i limitów pro-rata.">
              <input
                type="date"
                value={settings.dataRozpoczeciaDzialalnosci ?? ''}
                onChange={(e) => set('dataRozpoczeciaDzialalnosci', e.target.value || undefined)}
              />
            </Field>
            <div className="warn">
              Rok składkowy: styczeń 314,96 zł zdrowotnej / od lutego 432,54 zł (minimum).
            </div>
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Stawki 2026 są domyślne i edytowalne — po publikacji obwieszczeń ZUS/MF zaktualizuj liczby tutaj bez zmiany kodu.
      </p>
    </>
  );
}
