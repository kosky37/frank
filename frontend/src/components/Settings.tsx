import { useState, type JSX } from 'react';
import type { TaxForm } from '../../src-shared/tax/types.js';
import { PKD, RYCZALT } from '../../src-shared/dictionaries.js';
import { stawkiNaRok } from '../../src-shared/tax/rates2026.js';
import { skladkiSchematu, zusKodTytulu } from '../../src-shared/tax/zus.js';
import { api } from '../lib/api.js';
import { updateSettings, useStore } from '../lib/store.js';
import { isValidNip } from '../lib/format.js';
import { wczytajLogoUrl, zapiszLogoUrl } from '../lib/quickwins.js';
import { Backup } from './Backup.js';
import { RegistrySearch } from './Contractors.js';
import { Field } from './ui.js';

export function SettingsTab(): JSX.Element {
  const { settings } = useStore();
  const [showRates, setShowRates] = useState(false);
  const [rokStawek, setRokStawek] = useState(2026);
  const [logoUrl, setLogoUrl] = useState(wczytajLogoUrl);
  const dniDoPkd = Math.max(0, Math.round((Date.parse('2026-12-31') - Date.now()) / 86400000));
  const [pkdQ, setPkdQ] = useState('');
  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void {
    updateSettings({ [k]: v } as Partial<typeof settings>);
  }
  function zastosujStawki(): void {
    void api.stawki(rokStawek).then((s) => {
      updateSettings({
        zusSpoleczneMies: Number.isFinite(s.zusDuzySpoleczne) ? s.zusDuzySpoleczne : settings.zusSpoleczneMies,
        zusZdrowotnaMies: Number.isFinite(s.zusZdrowotnaMinLiniowy) ? s.zusZdrowotnaMinLiniowy : settings.zusZdrowotnaMies,
        zusFPMies: Number.isFinite(s.zusDuzyFP) ? s.zusDuzyFP : settings.zusFPMies,
        zusSchemat: 'duzy',
      });
    });
  }
  function togglePkd(kod: string): void {
    const cur = settings.pkd ?? [];
    set('pkd', cur.includes(kod) ? cur.filter((x) => x !== kod) : [...cur, kod]);
  }
  const pkdFiltrowane = PKD.filter((p) => {
    const q = pkdQ.trim().toLowerCase();
    if (!q) return true;
    return p.kod.toLowerCase().includes(q) || p.nazwa.toLowerCase().includes(q);
  });
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
      <div className="sections cols-2">
        <div className="col-stack">
        <div className="card">
          <h3>Moja firma (sprzedawca)</h3>
          <div className="stack">
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
            <div className="form-grid-2">
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
            <Field label="Kod urzędu skarbowego" hint="4 cyfry do nagłówka JPK (wykaz MF).">
              <input value={settings.kodUrzedu ?? ''} onChange={(e) => set('kodUrzedu', e.target.value)} placeholder="np. 1215" inputMode="numeric" />
            </Field>
            <Field label="Logo firmy (URL)" hint="PNG/SVG do nagłówka wydruku faktury (PDF). Zapisywane lokalnie w przeglądarce.">
              <input
                value={logoUrl}
                onChange={(e) => { setLogoUrl(e.target.value); zapiszLogoUrl(e.target.value); }}
                placeholder="https://…/logo.png"
                inputMode="url"
              />
              {logoUrl.trim() && (
                <img src={logoUrl.trim()} alt="podgląd logo" style={{ maxHeight: 48, maxWidth: 200, marginTop: 6 }} />
              )}
            </Field>
            <Field
              label="Kody PKD (CEIDG)"
              hint="Do informacji — stawkę ryczałtu wyznacza PKWiU usługi, nie PKD."
            >
              <div className="muted" style={{ marginBottom: 6 }}>
                Kody 2007 → 2025: zaktualizuj w CEIDG do <b>31.12.2026</b> (zostało {dniDoPkd} dni, potem auto-reklasyfikacja) •{' '}
                <a href="https://www.ceidg.gov.pl" target="_blank" rel="noreferrer">ceidg.gov.pl</a>
                {' '}• auto-mapa 2007→2025 wg tablicy GUS (do weryfikacji z urzędem).
              </div>
              <input
                value={pkdQ}
                onChange={(e) => setPkdQ(e.target.value)}
                placeholder="Filtruj PKD: np. 62.01 lub oprogramowanie…"
                aria-label="Filtruj kody PKD"
                style={{ marginBottom: 6 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                {pkdFiltrowane.length === 0 && <span className="muted">Brak wyników dla „{pkdQ}”.</span>}
                {pkdFiltrowane.map((p) => (
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
        <Backup />
        </div>
        <div className="col-stack">
        <div className="card">
          <h3>Opodatkowanie (2026)</h3>
          <div className="stack">
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
            <div className="form-grid-2">
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
          <div className="stack">
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
          <div className="stack">
            <div className="form-grid-3">
            <Field label="Składki społeczne">
              <input type="number" min={0} step="any" value={settings.zusSpoleczneMies} onChange={(e) => set('zusSpoleczneMies', Number(e.target.value))} />
            </Field>
            <Field label="Składka zdrowotna">
              <input type="number" min={0} step="any" value={settings.zusZdrowotnaMies} onChange={(e) => set('zusZdrowotnaMies', Number(e.target.value))} />
            </Field>
            <Field label="Fundusz Pracy">
              <input type="number" min={0} step="any" value={settings.zusFPMies} onChange={(e) => set('zusFPMies', Number(e.target.value))} />
            </Field>
            </div>
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
            <WyliczenieSchematu />
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
            <Field
              label="Wakacje składkowe (miesiąc)"
              hint="1 miesiąc w roku bez społecznych i FP — zdrowotna zostaje. Wybierz miesiąc, zwolnienie naliczy się samo."
            >
              <input
                type="month"
                value={settings.wakacjeSkladkoweMiesiac ?? ''}
                onChange={(e) => set('wakacjeSkladkoweMiesiac', e.target.value || undefined)}
              />
            </Field>
          </div>
        </div>
        <div className="card">
          <h3>Stawki na rok (automat)</h3>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Pobiera sugerowane składki ZUS i limity na dany rok (duży ZUS).
              Kursy walut pobierają się same z NBP przy fakturach walutowych.
            </p>
            <div className="form-grid-2" style={{ alignItems: 'end' }}>
              <Field label="Rok">
                <select value={rokStawek} onChange={(e) => setRokStawek(Number(e.target.value))}>
                  {[2025, 2026].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <button className="btn secondary" onClick={zastosujStawki}>
                Zastosuj stawki {rokStawek}
              </button>
            </div>
            <div className="muted">
              {(() => {
                const s = stawkiNaRok(rokStawek);
                return (
                  <>
                    Duży: społeczne {s.zusDuzySpoleczne} + zdrowotna min. {s.zusZdrowotnaMinLiniowy} + FP {s.zusDuzyFP}
                    {' '}• limit zdrowotnej (liniowy) {s.liniowyZdrowotnaLimitRoczny} • limit VAT {s.vatLimitZwolnienia}
                  </>
                );
              })()}
            </div>
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

/** 1-klik: podstaw składki z wyliczenia schematu (Mały ZUS Plus pyta o śr. dochód). */
function WyliczenieSchematu(): JSX.Element {
  const { settings } = useStore();
  const [dochod, setDochod] = useState('');
  const [info, setInfo] = useState('');
  const maly = settings.zusSchemat === 'maly_plus' || settings.zusSchemat === 'maly';

  function zastosuj(): void {
    const w = skladkiSchematu(settings.zusSchemat, Number(dochod) || 0);
    updateSettings({ zusSpoleczneMies: w.spoleczne, zusFPMies: w.fp });
    setInfo(`${w.opis} → społeczne ${w.spoleczne.toFixed(2)} zł, FP ${w.fp.toFixed(2)} zł (podstawa ${w.podstawa.toFixed(2)} zł). Zdrowotną policzymy od dochodu.`);
  }

  return (
    <div>
      {maly && (
        <Field label="Śr. mies. dochód zeszłego roku (Mały ZUS Plus)" hint="Podstawa = połowa, w widełkach 30% płacy min – 60% prognozy.">
          <input type="number" min={0} step="any" value={dochod} onChange={(e) => setDochod(e.target.value)} placeholder="np. 10000" />
        </Field>
      )}
      <button className="btn secondary small" onClick={zastosuj}>
        Podstaw wyliczenie schematu
      </button>
      {info && <div className="muted" style={{ marginTop: 6 }}>{info}</div>}
      <div className="muted" style={{ marginTop: 6 }}>
        FP 2,45% tylko od podstawy ≥ płacy min (4 806 zł) — niższa podstawa = 0 zł. Wypadkowa samodzielnego 1,67% wchodzi w składki społeczne.
      </div>
    </div>
  );
}
