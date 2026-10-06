import { useMemo, useState, type JSX } from 'react';
import { aggregateMonth } from '../../src-shared/tax/pit.js';
import {
  buildJpkEwp,
  buildJpkPkpir,
  buildJpkSt,
  czyNipPoprawny,
  mikrorachunek,
} from '../../src-shared/tax/integrations.js';
import { srodkiDoJpk } from './Majatek.js';
import type { SrodekTrwaly } from '../lib/majatek.js';
import { updateSettings, useStore } from '../lib/store.js';
import { api, ApiError } from '../lib/api.js';
import { monthLabel, todayISO } from '../lib/format.js';
import { Field } from './ui.js';
import { Audyt } from './Audyt.js';
import { DeklaracjeZus } from './DeklaracjeZus.js';
import { KsefOdbior } from './KsefOdbior.js';
import { KsefMasowa } from './KsefMasowa.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bladApi(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : 'Nieznany błąd';
}

const KODY_TYTULU = [
  { kod: '05 40', opis: 'Start (ulga 6 mies.)' },
  { kod: '05 70', opis: 'Preferencyjny' },
  { kod: '05 90', opis: 'Mały ZUS Plus' },
  { kod: '05 10', opis: 'Duży ZUS (sam za siebie)' },
  { kod: '01 10', opis: 'Duży ZUS (pracodawca)' },
];

const SRODOWISKA_KSEF = [
  { value: 'test', label: 'Test (api-test)', hint: 'Współdzielone środowisko integratorów — tylko dane testowe.' },
  { value: 'demo', label: 'Demo (api-demo)', hint: 'Przedprodukcyjne, konfiguracja jak na produkcji.' },
  { value: 'prod', label: 'Produkcja', hint: 'Prawdziwe faktury i UPO wiążące.' },
] as const;

export function IntegracjeTab(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const miesiace = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    if (s.size === 0) s.add(todayISO().slice(0, 7));
    return [...s].sort();
  }, [sales, costs]);
  const [miesiac, setMiesiac] = useState(miesiace[miesiace.length - 1] ?? todayISO().slice(0, 7));
  const [idFaktury, setIdFaktury] = useState('');
  const [ksefTest, setKsefTest] = useState('');
  const [ksefBusy, setKsefBusy] = useState(false);

  const fakturyMiesiaca = sales.filter(
    (s) => s.dataSprzedazy.slice(0, 7) === miesiac && s.status !== 'robocza',
  );
  const wybrana = fakturyMiesiaca.find((f) => f.id === idFaktury) ?? fakturyMiesiaca[0];
  const mikro =
    settings.firmaNip && czyNipPoprawny(settings.firmaNip) ? mikrorachunek(settings.firmaNip) : null;

  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]): void {
    updateSettings({ [k]: v } as Partial<typeof settings>);
  }

  async function sprawdzKsef(): Promise<void> {
    setKsefBusy(true);
    setKsefTest('');
    try {
      const r = await api.ksef.sprawdz();
      setKsefTest(`OK (${r.srodowisko}): ${r.info}`);
    } catch (e) {
      setKsefTest(`Błąd: ${bladApi(e)}`);
    } finally {
      setKsefBusy(false);
    }
  }

  const rokWybrany = miesiac.slice(0, 4);
  const sumyRoczne = useMemo(
    () => miesiace.filter((x) => x.startsWith(rokWybrany)).map((x) => aggregateMonth(x, sales, costs, settings)),
    [miesiace, rokWybrany, sales, costs, settings],
  );
  const srodkiTrwale: SrodekTrwaly[] = useMemo(() => {
    try {
      const raw = localStorage.getItem('frank-srodki-trwale');
      if (raw) return JSON.parse(raw) as SrodekTrwaly[];
    } catch { /* ignore */ }
    return [];
  }, [miesiac]);

  const kwartalZTegoMiesiaca = `${miesiac.slice(0, 4)}-Q${Math.floor((Number(miesiac.slice(5, 7)) - 1) / 3) + 1}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Integracje</h2>
          <p>KSeF, JPK_V7M, ZUS DRA (KEDU), NBP i mikrorachunek — klucze w jednym miejscu, wysyłka z aplikacji.</p>
        </div>
      </div>
      <div className="sections cols-2">
        <div className="col-stack">
        <div className="card">
          <h3>Środowisko i klucze</h3>
          <div className="stack">
            <Field label="Środowisko KSeF">
              <div className="seg" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                {SRODOWISKA_KSEF.map((o) => (
                  <label className="inline" key={o.value} title={o.hint}>
                    <input
                      type="radio"
                      checked={(settings.ksefSrodowisko ?? 'test') === o.value}
                      onChange={() => set('ksefSrodowisko', o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Token KSeF 2.0" hint="Aplikacja Podatnika → Ustawienia → Tokeny (logowanie Profilem Zaufanym, jednorazowo) → wklej tutaj. Do 31.12.2026, potem certyfikat + ZAW-FA.">
              <input
                type="password"
                value={settings.ksefToken ?? ''}
                onChange={(e) => set('ksefToken', e.target.value)}
                placeholder="Wklej token…"
                autoComplete="off"
              />
            </Field>
            <div className="row">
              <button className="btn secondary small" disabled={ksefBusy} onClick={() => void sprawdzKsef()}>
                {ksefBusy ? 'Sprawdzanie…' : 'Sprawdź połączenie z KSeF'}
              </button>
            </div>
            {ksefTest && <div className="muted">{ksefTest}</div>}
            <Field label="Klucz API GUS BIR (REGON)" hint="Z api.stat.gov.pl — NBP nie wymaga klucza.">
              <input
                value={settings.gusApiKey ?? ''}
                onChange={(e) => set('gusApiKey', e.target.value)}
                placeholder="Klucz BIR…"
                autoComplete="off"
              />
            </Field>
            <Field label="Indywidualny rachunek ZUS (NRS)" hint="Z PUE/eZUS — służy do przelewów składek.">
              <input
                value={settings.zusNrs ?? ''}
                onChange={(e) => set('zusNrs', e.target.value)}
                placeholder="NRS…"
                inputMode="numeric"
              />
            </Field>
            <Field label="Kod tytułu ZUS">
              <select value={settings.zusKodTytulu ?? '05 10'} onChange={(e) => set('zusKodTytulu', e.target.value)}>
                {KODY_TYTULU.map((k) => (
                  <option key={k.kod} value={k.kod}>
                    {k.kod} — {k.opis}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Adres e-Doręczeń" hint="Obowiązkowy dla CEIDG od 1.10.2026 (edoreczenia.gov.pl).">
              <input
                value={settings.edoreczeniaAdres ?? ''}
                onChange={(e) => set('edoreczeniaAdres', e.target.value)}
                placeholder="ADE:PL-…"
              />
            </Field>
            <div className="muted">
              e-Doręczenia: {settings.edoreczeniaAdres ? <>skrzynka <b>{settings.edoreczeniaAdres}</b> — sprawdzaj powiadomienia z US/ZUS</> : 'uzupełnij adres skrzynki'} •{' '}
              <a href="https://edoreczenia.gov.pl" target="_blank" rel="noreferrer">edoreczenia.gov.pl</a>
            </div>
            <div className="muted">
              Certyfikat KSeF: tokeny umierają 31.12.2026 — wyrób certyfikat / pieczęć + ZAW-FA przed grudniem (kary za brak KSeF od 2028).
            </div>
          </div>
        </div>

        <JpkWysylka miesiac={miesiac} onMiesiac={setMiesiac} miesiace={miesiace} kwartal={kwartalZTegoMiesiaca} />
        </div>
        <div className="col-stack">
          <Audyt miesiac={miesiac} sales={sales} settings={settings} />

          <KsefMasowa miesiac={miesiac} faktury={fakturyMiesiaca} />

          <KsefOdbior />
        </div>

        <div className="span-full">
          <DeklaracjeZus miesiace={miesiace} sales={sales} costs={costs} settings={settings} />
        </div>

        <div className="span-full">
        <div className="card">
          <h3>Pliki roczne (trzymaj, wyślesz w 2027 za 2026)</h3>
          <div className="btn-grid">
            <button
              className="btn secondary"
              title="Księga Przychodów i Rozchodów za rok (trzymaj miesięcznie, wyślesz w 2027 za 2026)"
              onClick={() => download(`JPK_PKPIR-${rokWybrany}.xml`, buildJpkPkpir(rokWybrany, sumyRoczne, {}).payload)}
            >
              Pobierz JPK_PKPIR
            </button>
            <button
              className="btn secondary"
              title="Ewidencja przychodów ryczałtowca za rok (wymóg art. 15)"
              onClick={() => download(`JPK_EWP-${rokWybrany}.xml`, buildJpkEwp(rokWybrany, sumyRoczne, {}).payload)}
            >
              Pobierz JPK_EWP
            </button>
            <button
              className="btn secondary"
              title="Ewidencja środków trwałych z rejestru amortyzacji (Koszty → Majątek)"
              onClick={() => download(`JPK_ST-${rokWybrany}.xml`, buildJpkSt(srodkiDoJpk(srodkiTrwale, Number(rokWybrany)), {}).payload)}
            >
              Pobierz JPK_ST
            </button>
          </div>
          {mikro ? (
            <p className="muted">
              Mikrorachunek z NIP firmy (do weryfikacji w generatorze MF): <b>{mikro}</b>{' '}
              <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(mikro)}>Kopiuj</button>
            </p>
          ) : (
            <p className="muted">Uzupełnij NIP firmy, by pokazać mikrorachunek do PIT/VAT.</p>
          )}
          {settings.zusNrs ? (
            <p className="muted">
              NRS do składek ZUS: <b>{settings.zusNrs}</b>{' '}
              <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(settings.zusNrs ?? '')}>Kopiuj</button>
            </p>
          ) : (
            <p className="muted">Uzupełnij NRS powyżej — składki ZUS płacisz jednym przelewem do 20.</p>
          )}
        </div>
        </div>

        <div className="span-full">
        <div className="card">
          <h3>Jak to podłączyć (skrót)</h3>
          <ol className="muted" style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>KSeF: token z Aplikacji Podatnika (logowanie Profilem Zaufanym, jednorazowo) → wklej wyżej → „Sprawdź połączenie” → wysyłka z zakładki Sprzedaż lub masowo niżej. Środowisko testowe współdzielą integratorzy — tylko dane testowe.</li>
            <li>JPK_V7M/V7K: podgląd XML z walidacją XSD MF, potem wysyłka danymi autoryzującymi (NIP/PESEL + imię + nazwisko + data urodzenia + przychód sprzed 2 lat) — tylko osoby fizyczne (JDG). UPO wraca do aplikacji.</li>
            <li>ZUS: brak API do wysyłki — pobierz KEDU z sekcji DRA niżej, zaimportuj w Płatniku/ePłatniku, podpisz Profilem Zaufanym i wyślij do 20.</li>
            <li>GUS BIR: klucz z api.stat.gov.pl; NBP bez klucza (kursy z automatu).</li>
            <li>e-Doręczenia: skrzynka na edoreczenia.gov.pl; Twój e-PIT: 15 II – 30 IV.</li>
          </ol>
          <p className="muted">Pełna instrukcja klik-po-kliku: <b>docs/INTEGRACJE.md</b> (test vs prod).</p>
        </div>
        </div>
      </div>
    </>
  );
}

/** Wysyłka JPK_V7M(3)/V7K(3) danymi autoryzującymi — podgląd XSD, wysyłka, status/UPO. */
function JpkWysylka({ miesiac, onMiesiac, miesiace, kwartal }: {
  miesiac: string;
  onMiesiac: (m: string) => void;
  miesiace: string[];
  kwartal: string;
}): JSX.Element {
  const { settings } = useStore();
  const [kwartalny, setKwartalny] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [refNum, setRefNum] = useState('');
  // Dane autoryzujące — tylko w locie, nie zapisywane (RODO).
  const [imie, setImie] = useState('');
  const [nazwisko, setNazwisko] = useState('');
  const [dataUrodzenia, setDataUrodzenia] = useState('');
  const [telefon, setTelefon] = useState('');
  const [kodUrzedu, setKodUrzedu] = useState('');
  const [nipLubPesel, setNipLubPesel] = useState('');
  const [kwota, setKwota] = useState('');
  const [cel, setCel] = useState(1);

  const okresLabel = kwartalny ? kwartal : miesiac;

  async function podglad(): Promise<void> {
    setBusy(true);
    setInfo('');
    try {
      const r = await api.jpk.podglad(kwartalny ? undefined : miesiac, kwartalny ? kwartal : undefined);
      download(`JPK_${kwartalny ? 'V7K-' + kwartal : 'V7M-' + miesiac}.xml`, r.xml);
      const uwaga = r.uwaga ? ` ${r.uwaga}` : '';
      const pom = (r.pominiete ?? []).length > 0 ? ` Pominięto: ${(r.pominiete ?? []).join('; ')}.` : '';
      setInfo(
        r.walidacja.ok
          ? `${r.formCode}: XML zgodny ze schematem MF (XSD przeszła).${pom}${uwaga}`
          : r.walidacja.pominieta
            ? `${r.formCode}: pobrano; walidacja XSD pominięta (${r.walidacja.bledy.slice(0, 2).join('; ')}).${pom}${uwaga}`
            : `${r.formCode}: NIEZGODNY z XSD — ${r.walidacja.bledy.slice(0, 3).join('; ')}${pom}${uwaga}`,
      );
    } catch (e) {
      setInfo(`Błąd podglądu: ${bladApi(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function wyslij(prod: boolean): Promise<void> {
    setBusy(true);
    setInfo('');
    try {
      const r = await api.jpk.wyslij({
        miesiac: kwartalny ? undefined : miesiac,
        kwartal: kwartalny ? kwartal : undefined,
        srodowisko: prod ? 'prod' : 'test',
        celZlozenia: cel,
        osobaFizyczna: true,
        imie, nazwisko, dataUrodzenia,
        telefon: telefon || undefined,
        kodUrzedu: kodUrzedu || settings.kodUrzedu || undefined,
        nipLubPesel: nipLubPesel || settings.firmaNip || undefined,
        kwotaPrzychodu: Number(kwota) || 0,
        zwrotTryb: 'P_540',
      });
      setRefNum(r.referenceNumber);
      const pom = (r.pominiete ?? []).length > 0 ? ` Pominięto w ewidencji: ${(r.pominiete ?? []).join('; ')}.` : '';
      setInfo(
        r.kod === 200
          ? `Przyjęto (UPO poniżej). Ref: ${r.referenceNumber} — ${r.opis}${pom}`
          : `Bramka zwróciła kod ${r.kod}: ${r.opis} (ref ${r.referenceNumber})${pom}`,
      );
      if (r.upo) download(`UPO-JPK-${okresLabel}.xml`, r.upo);
    } catch (e) {
      setInfo(`Błąd wysyłki: ${bladApi(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sprawdzStatus(): Promise<void> {
    if (!refNum) { setInfo('Brak numeru referencyjnego — najpierw wyślij.'); return; }
    setBusy(true);
    try {
      const s = await api.jpk.status(refNum, 'test');
      setInfo(`Status ${refNum}: ${JSON.stringify(s).slice(0, 400)}`);
    } catch (e) {
      setInfo(`Błąd statusu: ${bladApi(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>JPK_V7 — podgląd i wysyłka</h3>
      {(!settings.firmaNip || !czyNipPoprawny(settings.firmaNip)) && (
        <div className="warn" style={{ marginBottom: 12 }}>
          Uzupełnij poprawny NIP firmy w Ustawieniach — JPK bez NIP zostanie odrzucony przez MF.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Okres">
          <div className="row">
            <select aria-label="Miesiąc JPK" className="compact" value={miesiac} onChange={(e) => onMiesiac(e.target.value)}>
              {miesiace.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            <label className="inline" title="Deklaracja kwartalna V7K (ewidencja z 3 miesięcy)">
              <input type="checkbox" checked={kwartalny} onChange={(e) => setKwartalny(e.target.checked)} />
              V7K ({kwartal})
            </label>
          </div>
        </Field>
        <div className="row">
          <button className="btn secondary" disabled={busy} onClick={() => void podglad()}>
            {busy ? '…' : 'Podgląd JPK (XSD)'}
          </button>
        </div>
        <div>
          <b>Dane autoryzujące (podpis przychodem)</b>
          <p className="muted">
            NIP/PESEL + imię + nazwisko + data urodzenia + przychód z zeznania sprzed 2 lat
            (w 2026 → przychód za 2024; 0 gdy brak). Tylko JDG (osoby fizyczne).
            Danych nie zapisujemy — są używane wyłącznie do tej wysyłki.
          </p>
          <div className="form-grid-3">
            <Field label="Imię"><input value={imie} onChange={(e) => setImie(e.target.value)} autoComplete="off" /></Field>
            <Field label="Nazwisko"><input value={nazwisko} onChange={(e) => setNazwisko(e.target.value)} autoComplete="off" /></Field>
            <Field label="Data urodzenia"><input value={dataUrodzenia} onChange={(e) => setDataUrodzenia(e.target.value)} placeholder="RRRR-MM-DD" inputMode="numeric" /></Field>
            <Field label="NIP albo PESEL"><input value={nipLubPesel} onChange={(e) => setNipLubPesel(e.target.value)} placeholder={settings.firmaNip ?? 'NIP/PESEL'} inputMode="numeric" /></Field>
            <Field label="Przychód sprzed 2 lat"><input type="number" min={0} step="any" value={kwota} onChange={(e) => setKwota(e.target.value)} placeholder="np. 180000" /></Field>
            <Field label="Telefon (do JPK)"><input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder={settings.firmaTelefon ?? ''} /></Field>
            <Field label="Kod urzędu"><input value={kodUrzedu} onChange={(e) => setKodUrzedu(e.target.value)} placeholder={settings.kodUrzedu ?? '4 cyfry'} inputMode="numeric" /></Field>
            <Field label="Cel złożenia">
              <select value={cel} onChange={(e) => setCel(Number(e.target.value))}>
                <option value={1}>1 — złożenie</option>
                <option value={2}>2 — korekta</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void wyslij(false)}>
            {busy ? 'Wysyłanie…' : `Wyślij JPK za ${okresLabel} (test)`}
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => void wyslij(true)} title="Prawdziwa wysyłka do US — dopiero po udanym teście">
            {busy ? 'Wysyłanie…' : 'Wyślij (produkcja)'}
          </button>
          <button className="btn ghost small" disabled={busy || !refNum} onClick={() => void sprawdzStatus()}>
            Sprawdź status
          </button>
        </div>
        {refNum && <div className="muted">Ref: {refNum}</div>}
        {info && <div className="muted">{info}</div>}
      </div>
    </div>
  );
}
