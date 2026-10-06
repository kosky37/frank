import { useState, type JSX } from 'react';
import type { TaxForm } from '../../src-shared/tax/types.js';
import { PKD, RYCZALT } from '../../src-shared/dictionaries.js';
import { stawkiNaRok } from '../../src-shared/tax/rates2026.js';
import { skladkiSchematu, zusKodTytulu } from '../../src-shared/tax/zus.js';
import { api } from '../lib/api.js';
import { updateSettings, useStore } from '../lib/store.js';
import { isValidNip } from '../lib/format.js';
import { wczytajLogoUrl, zapiszLogoUrl } from '../lib/quickwins.js';
import { useSubTab } from '../lib/router.js';
import { Backup } from './Backup.js';
import { RegistrySearch } from './Contractors.js';
import { Field, Tabs, toast } from './ui.js';

const KODY_TYTULU = [
  { kod: '05 40', opis: 'Start (ulga 6 mies.)' },
  { kod: '05 70', opis: 'Preferencyjny' },
  { kod: '05 90', opis: 'Mały ZUS Plus' },
  { kod: '05 10', opis: 'Duży ZUS' },
];

const ZAKLADKI = ['firma', 'podatki', 'zus', 'dane'] as const;
type Zakladka = (typeof ZAKLADKI)[number];

/** Rachunek: same cyfry 26 (PL) albo IBAN z prefiksem kraju. */
function rachunekOk(r: string): boolean {
  const s = r.replace(/\s/g, '').toUpperCase();
  return /^\d{26}$/.test(s) || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s);
}

export function SettingsTab(): JSX.Element {
  const [tab, setTab] = useSubTab<Zakladka>('ustawienia', ZAKLADKI, 'firma');
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Ustawienia</h2>
          <p>Zmiany zapisują się automatycznie i od razu przeliczają podatki w całej aplikacji.</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'firma', label: 'Firma i faktury' },
          { id: 'podatki', label: 'Podatki i VAT' },
          { id: 'zus', label: 'ZUS' },
          { id: 'dane', label: 'Kopia zapasowa' },
        ]}
      />
      {tab === 'firma' && <FirmaUstawienia />}
      {tab === 'podatki' && <PodatkiUstawienia />}
      {tab === 'zus' && <ZusUstawienia />}
      {tab === 'dane' && <Backup />}
    </>
  );
}

function FirmaUstawienia(): JSX.Element {
  const { settings } = useStore();
  const [logoUrl, setLogoUrl] = useState(wczytajLogoUrl);
  const [pkdQ, setPkdQ] = useState('');
  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void => updateSettings({ [k]: v } as Partial<typeof settings>);
  const nipWarn = settings.firmaNip && !isValidNip(settings.firmaNip) ? 'Błędna suma kontrolna NIP.' : undefined;
  const rachunekWarn = settings.firmaRachunek && !rachunekOk(settings.firmaRachunek) ? 'Numer rachunku wygląda na niepełny (26 cyfr).' : undefined;
  const dniDoPkd = Math.max(0, Math.round((Date.parse('2026-12-31') - Date.now()) / 86400000));
  const pkdFiltrowane = PKD.filter((p) => {
    const q = pkdQ.trim().toLowerCase();
    return !q || p.kod.toLowerCase().includes(q) || p.nazwa.toLowerCase().includes(q);
  });
  const togglePkd = (kod: string): void => {
    const cur = settings.pkd ?? [];
    set('pkd', cur.includes(kod) ? cur.filter((x) => x !== kod) : [...cur, kod]);
  };

  return (
    <div className="grid-2">
      <div className="stack">
        <div className="card">
          <h3>Dane sprzedawcy</h3>
          <div className="stack">
            <div className="form-grid-2">
              <Field label="NIP" error={nipWarn}>
                <input value={settings.firmaNip ?? ''} onChange={(e) => set('firmaNip', e.target.value.replace(/[^\d]/g, ''))} placeholder="10 cyfr" inputMode="numeric" />
              </Field>
              <Field label="REGON">
                <input value={settings.firmaRegon ?? ''} onChange={(e) => set('firmaRegon', e.target.value)} placeholder="9 lub 14 cyfr" />
              </Field>
            </div>
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
                toast('Uzupełniono dane firmy z rejestru');
              }}
            />
            <Field label="Nazwa firmy" hint="Dokładnie jak w CEIDG — trafia na faktury i do JPK.">
              <input value={settings.firmaNazwa ?? ''} onChange={(e) => set('firmaNazwa', e.target.value)} placeholder="Jan Kowalski Software" />
            </Field>
            <Field label="Adres">
              <input value={settings.firmaAdres ?? ''} onChange={(e) => set('firmaAdres', e.target.value)} placeholder="ul. Przykładowa 1, 00-001 Warszawa" />
            </Field>
            <div className="form-grid-2">
              <Field label="E-mail">
                <input type="email" value={settings.firmaEmail ?? ''} onChange={(e) => set('firmaEmail', e.target.value)} placeholder="kontakt@firma.pl" />
              </Field>
              <Field label="Telefon">
                <input value={settings.firmaTelefon ?? ''} onChange={(e) => set('firmaTelefon', e.target.value)} placeholder="+48 …" />
              </Field>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Domyślne na fakturach</h3>
          <div className="stack">
            <Field label="Rachunek bankowy" error={rachunekWarn} hint="Podstawia się na nowych fakturach, w PDF i w KSeF (FA(3) → Płatność).">
              <input value={settings.firmaRachunek ?? ''} onChange={(e) => set('firmaRachunek', e.target.value)} placeholder="PL 00 0000 0000 0000 0000 0000 0000" />
            </Field>
            <div className="form-grid-2">
              <Field label="Nazwa banku">
                <input value={settings.firmaBank ?? ''} onChange={(e) => set('firmaBank', e.target.value)} placeholder="np. mBank" />
              </Field>
              <Field label="Termin płatności (dni)">
                <input type="number" min={1} max={365} value={settings.terminPlatnosciDni ?? 14} onChange={(e) => set('terminPlatnosciDni', Math.max(1, Math.min(365, Number(e.target.value) || 14)))} />
              </Field>
            </div>
            <Field label="Logo (URL obrazka)" hint="PNG/SVG w nagłówku PDF. Zapisywane tylko w tej przeglądarce.">
              <input
                value={logoUrl}
                onChange={(e) => { setLogoUrl(e.target.value); zapiszLogoUrl(e.target.value); }}
                placeholder="https://…/logo.png"
                inputMode="url"
              />
              {logoUrl.trim() && <img src={logoUrl.trim()} alt="podgląd logo" style={{ maxHeight: 44, maxWidth: 200, marginTop: 6 }} />}
            </Field>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h3>Urzędy</h3>
          <div className="stack">
            <Field label="Rachunek składkowy ZUS (NRS)" hint="Indywidualny numer z PUE/eZUS — jeden przelew na wszystkie składki.">
              <input value={settings.zusNrs ?? ''} onChange={(e) => set('zusNrs', e.target.value)} placeholder="26 cyfr" inputMode="numeric" />
            </Field>
            <Field label="Kod urzędu skarbowego" hint="4 cyfry do JPK_V7 (lista na podatki.gov.pl).">
              <input value={settings.kodUrzedu ?? ''} onChange={(e) => set('kodUrzedu', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="np. 1435" inputMode="numeric" />
            </Field>
            <Field label="Data rozpoczęcia działalności" hint="Do ulg ZUS i limitu zwolnienia VAT liczonego proporcjonalnie.">
              <input type="date" value={settings.dataRozpoczeciaDzialalnosci ?? ''} onChange={(e) => set('dataRozpoczeciaDzialalnosci', e.target.value || undefined)} />
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Kody PKD</h3>
            <span className="muted">{(settings.pkd ?? []).length} wybrane</span>
          </div>
          <div className="stack">
            {dniDoPkd > 0 && (
              <div className="info">
                Zmiana na PKD 2025: zaktualizuj kody w <a href="https://www.ceidg.gov.pl" target="_blank" rel="noreferrer">CEIDG</a> do 31.12.2026 (zostało {dniDoPkd} dni).
              </div>
            )}
            <input value={pkdQ} onChange={(e) => setPkdQ(e.target.value)} placeholder="Szukaj: 62.01 albo „oprogramowanie”…" aria-label="Filtruj kody PKD" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
              {pkdFiltrowane.length === 0 && <span className="muted">Brak wyników dla „{pkdQ}”.</span>}
              {pkdFiltrowane.map((p) => (
                <label key={p.kod} className="inline" style={{ fontWeight: 400, padding: '3px 0' }}>
                  <input type="checkbox" checked={(settings.pkd ?? []).includes(p.kod)} onChange={() => togglePkd(p.kod)} />
                  <span><b>{p.kod}</b> — {p.nazwa}</span>
                </label>
              ))}
            </div>
            <div className="field-hint">Stawkę ryczałtu wyznacza PKWiU usługi, nie PKD.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PodatkiUstawienia(): JSX.Element {
  const { settings } = useStore();
  const [showRates, setShowRates] = useState(false);
  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void => updateSettings({ [k]: v } as Partial<typeof settings>);
  return (
    <div className="grid-2">
      <div className="card">
        <h3>Podatek dochodowy</h3>
        <div className="stack">
          <Field label="Forma opodatkowania" hint="Porównasz formy na swoich danych w Podatki → Porównanie form.">
            <select value={settings.formaOpodatkowania} onChange={(e) => set('formaOpodatkowania', e.target.value as TaxForm)}>
              <option value="skala">Skala podatkowa (12% / 32%)</option>
              <option value="liniowy">Podatek liniowy 19%</option>
              <option value="ryczalt">Ryczałt od przychodów ewidencjonowanych</option>
            </select>
          </Field>
          <Field label="Zaliczki PIT">
            <select value={settings.zaliczkaPit} onChange={(e) => set('zaliczkaPit', e.target.value as typeof settings.zaliczkaPit)}>
              <option value="miesieczna">Miesięczne (do 20. następnego miesiąca)</option>
              <option value="kwartalna">Kwartalne (mały podatnik — do 20. po kwartale)</option>
            </select>
          </Field>
          {settings.formaOpodatkowania === 'ryczalt' && (
            <>
              <Field label="Domyślna stawka ryczałtu" hint="Na fakturze możesz wybrać inną stawkę dla pozycji.">
                <select value={String(settings.stawkaRyczaltu)} onChange={(e) => set('stawkaRyczaltu', Number(e.target.value))}>
                  {RYCZALT.map((o) => (
                    <option key={o.stawka} value={String(o.stawka)}>{(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}% — {o.tytul}</option>
                  ))}
                </select>
              </Field>
              <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowRates(!showRates)}>
                {showRates ? 'Ukryj stawki' : 'Która stawka? Pokaż tabelę stawek'}
              </button>
              {showRates && (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Stawka</th><th>Zakres</th></tr></thead>
                    <tbody>
                      {RYCZALT.map((o) => (
                        <tr key={o.stawka}>
                          <td style={{ whiteSpace: 'nowrap' }}><b>{(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}%</b><span className="sub">{o.tytul}</span></td>
                          <td>{o.zakres}<span className="sub">np. {o.przyklady}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <h3>VAT</h3>
          <div className="stack">
            <label className="inline">
              <input type="checkbox" checked={settings.vatowiec} onChange={(e) => set('vatowiec', e.target.checked)} />
              Jestem czynnym podatnikiem VAT
            </label>
            {settings.vatowiec ? (
              <Field label="Rozliczenie VAT">
                <select value={settings.okresVat} onChange={(e) => set('okresVat', e.target.value as typeof settings.okresVat)}>
                  <option value="miesieczny">Miesięczne — JPK_V7M do 25.</option>
                  <option value="kwartalny">Kwartalne — JPK_V7K (deklaracja po kwartale)</option>
                </select>
              </Field>
            ) : (
              <div className="muted">Zwolnienie podmiotowe (art. 113): faktury bez VAT, limit sprzedaży widoczny na Pulpicie. Koszty księgujesz w kwocie brutto.</div>
            )}
          </div>
        </div>
        <div className="card">
          <h3>Samochód</h3>
          <div className="stack">
            <Field label="Wykorzystanie" hint="Mieszane: 50% VAT do odliczenia, 75% kosztu w PIT.">
              <select value={settings.uzytkowaniePojazdu} onChange={(e) => set('uzytkowaniePojazdu', e.target.value as typeof settings.uzytkowaniePojazdu)}>
                <option value="mieszany">Mieszane (prywatnie i firmowo)</option>
                <option value="wylacznie_firma">Wyłącznie firmowe (VAT-26 + ewidencja przebiegu)</option>
                <option value="prywatny">Prywatne (bez odliczeń)</option>
              </select>
            </Field>
            {settings.uzytkowaniePojazdu === 'wylacznie_firma' && (
              <label className="inline">
                <input type="checkbox" checked={settings.vat26Zgloszony} onChange={(e) => set('vat26Zgloszony', e.target.checked)} />
                VAT-26 złożony w urzędzie
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZusUstawienia(): JSX.Element {
  const { settings } = useStore();
  const [rokStawek, setRokStawek] = useState(2026);
  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void => updateSettings({ [k]: v } as Partial<typeof settings>);
  const s = stawkiNaRok(rokStawek);
  function zastosujStawki(): void {
    void api.stawki(rokStawek).then((x) => {
      updateSettings({
        zusSpoleczneMies: Number.isFinite(x.zusDuzySpoleczne) ? x.zusDuzySpoleczne : settings.zusSpoleczneMies,
        zusZdrowotnaMies: Number.isFinite(x.zusZdrowotnaMinLiniowy) ? x.zusZdrowotnaMinLiniowy : settings.zusZdrowotnaMies,
        zusFPMies: Number.isFinite(x.zusDuzyFP) ? x.zusDuzyFP : settings.zusFPMies,
        zusSchemat: 'duzy',
      });
      toast(`Zastosowano stawki dużego ZUS na ${rokStawek}`);
    }).catch(() => toast('Nie udało się pobrać stawek z API', 'err'));
  }
  return (
    <div className="grid-2">
      <div className="card">
        <h3>Składki</h3>
        <div className="stack">
          <Field label="Schemat ZUS" hint="Ulga na start: tylko zdrowotna przez 6 mies. • preferencyjny: 24 mies. • Mały ZUS Plus: podstawa od dochodu.">
            <select value={settings.zusSchemat} onChange={(e) => set('zusSchemat', e.target.value as typeof settings.zusSchemat)}>
              <option value="start">Ulga na start (tylko zdrowotna)</option>
              <option value="preferencyjny">Preferencyjny (bez FP)</option>
              <option value="maly_plus">Mały ZUS Plus</option>
              <option value="duzy">Pełny („duży”) ZUS</option>
              {(settings.zusSchemat === 'ulgowy' || settings.zusSchemat === 'maly') && (
                <option value={settings.zusSchemat}>Starszy zapis: {settings.zusSchemat}</option>
              )}
            </select>
          </Field>
          <div className="form-grid-3">
            <Field label="Społeczne / mies.">
              <input type="number" min={0} step="any" value={settings.zusSpoleczneMies} onChange={(e) => set('zusSpoleczneMies', Number(e.target.value))} />
            </Field>
            <Field label="Zdrowotna min.">
              <input type="number" min={0} step="any" value={settings.zusZdrowotnaMies} onChange={(e) => set('zusZdrowotnaMies', Number(e.target.value))} />
            </Field>
            <Field label="Fundusz Pracy">
              <input type="number" min={0} step="any" value={settings.zusFPMies} onChange={(e) => set('zusFPMies', Number(e.target.value))} />
            </Field>
          </div>
          <WyliczenieSchematu />
          <div className="muted">
            Zdrowotna liczy się sama co miesiąc: skala 9% i liniowy 4,9% dochodu z poprzedniego miesiąca (nie mniej niż minimum),
            ryczałt — według progu przychodu.
          </div>
          <Field label="Wakacje składkowe" hint="Jeden miesiąc w roku bez składek społecznych i FP (zdrowotna zostaje).">
            <input type="month" value={settings.wakacjeSkladkoweMiesiac ?? ''} onChange={(e) => set('wakacjeSkladkoweMiesiac', e.target.value || undefined)} />
          </Field>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <h3>Deklaracja DRA</h3>
          <div className="stack">
            <Field label="Kod tytułu ubezpieczenia" hint={`Wynikający ze schematu: ${zusKodTytulu(settings.zusSchemat)}`}>
              <select value={settings.zusKodTytulu ?? zusKodTytulu(settings.zusSchemat)} onChange={(e) => set('zusKodTytulu', e.target.value)}>
                {KODY_TYTULU.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.opis}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div className="card">
          <h3>Stawki na rok</h3>
          <div className="stack">
            <div className="form-grid-2" style={{ alignItems: 'end' }}>
              <Field label="Rok">
                <select value={rokStawek} onChange={(e) => setRokStawek(Number(e.target.value))}>
                  {[2025, 2026].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <button className="btn secondary" onClick={zastosujStawki}>Zastosuj pełny ZUS {rokStawek}</button>
            </div>
            <dl className="dl">
              <dt>Społeczne (pełny ZUS)</dt><dd>{s.zusDuzySpoleczne} zł</dd>
              <dt>Fundusz Pracy</dt><dd>{s.zusDuzyFP} zł</dd>
              <dt>Zdrowotna minimalna</dt><dd>{s.zusZdrowotnaMinLiniowy} zł</dd>
              <dt>Limit odliczenia zdrowotnej (liniowy)</dt><dd>{s.liniowyZdrowotnaLimitRoczny} zł</dd>
              <dt>Limit zwolnienia z VAT</dt><dd>{s.vatLimitZwolnienia} zł</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 1-klik: podstaw składki z wyliczenia schematu (Mały ZUS Plus pyta o śr. dochód). */
function WyliczenieSchematu(): JSX.Element {
  const { settings } = useStore();
  const [dochod, setDochod] = useState('');
  const maly = settings.zusSchemat === 'maly_plus' || settings.zusSchemat === 'maly';

  function zastosuj(): void {
    const w = skladkiSchematu(settings.zusSchemat, Number(dochod) || 0);
    updateSettings({ zusSpoleczneMies: w.spoleczne, zusFPMies: w.fp });
    toast(`${w.opis}: społeczne ${w.spoleczne.toFixed(2)} zł, FP ${w.fp.toFixed(2)} zł`);
  }

  return (
    <div className="stack">
      {maly && (
        <Field label="Średni miesięczny dochód z zeszłego roku" hint="Podstawa = połowa dochodu, w widełkach 30% płacy minimalnej – 60% przeciętnego wynagrodzenia.">
          <input type="number" min={0} step="any" value={dochod} onChange={(e) => setDochod(e.target.value)} placeholder="np. 10000" />
        </Field>
      )}
      <div>
        <button className="btn secondary small" onClick={zastosuj}>Wylicz składki dla schematu</button>
      </div>
    </div>
  );
}
