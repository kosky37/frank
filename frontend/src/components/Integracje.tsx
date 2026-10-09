import { useEffect, useMemo, useState, type JSX } from 'react';
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
import { useSubTab } from '../lib/router.js';
import { Badge, Field, Icon, kopiuj, Tabs, toast } from './ui.js';
import { Audyt } from './Audyt.js';
import { DeklaracjeZus } from './DeklaracjeZus.js';
import { KsefOdbior } from './KsefOdbior.js';
import { UrzadLookup } from './UrzadLookup.js';
import { KsefMasowa } from './KsefMasowa.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bladApi(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : 'Nieznany błąd';
}

/** Ostatnie `n` miesięcy do bieżącego włącznie (najnowszy pierwszy). */
export function ostatnieMiesiace(dzisISO: string, n: number): string[] {
  const out: string[] = [];
  let y = Number(dzisISO.slice(0, 4));
  let m = Number(dzisISO.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

const SRODOWISKA_KSEF = [
  { value: 'test', label: 'Test', hint: 'Współdzielone środowisko integratorów — tylko dane testowe.' },
  { value: 'demo', label: 'Demo', hint: 'Przedprodukcyjne, konfiguracja jak na produkcji.' },
  { value: 'prod', label: 'Produkcja', hint: 'Prawdziwe faktury i wiążące UPO.' },
] as const;

const ZAKLADKI = ['ksef', 'jpk', 'zus', 'roczne', 'pomoc'] as const;
type Zakladka = (typeof ZAKLADKI)[number];

export function IntegracjeTab(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const [tab, setTab] = useSubTab<Zakladka>('integracje', ZAKLADKI, 'ksef');
  const dzis = todayISO();
  const miesiace = useMemo(() => {
    const s = new Set(ostatnieMiesiace(dzis, 18));
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    return [...s].filter((m) => m <= dzis.slice(0, 7)).sort().reverse();
  }, [sales, costs, dzis]);
  // w bieżącym miesiącu rozlicza się poprzedni
  const [miesiac, setMiesiac] = useState(ostatnieMiesiace(dzis, 2)[1]);
  const fakturyMiesiaca = sales.filter((s) => s.dataSprzedazy.slice(0, 7) === miesiac && s.status !== 'robocza');
  const kwartal = `${miesiac.slice(0, 4)}-Q${Math.floor((Number(miesiac.slice(5, 7)) - 1) / 3) + 1}`;
  const doWyslaniaKsef = sales.filter((s) => s.status === 'wystawiona' && (s.rodzaj ?? 'sprzedazy') !== 'proforma').length;

  const wyborMiesiaca = (
    <select aria-label="Okres" className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
      {miesiace.map((m) => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h2>e-Urząd</h2>
          <p>KSeF, JPK_V7 i ZUS — przygotowanie, walidacja schematem MF/ZUS i wysyłka z aplikacji.</p>
        </div>
        {(tab === 'jpk' || tab === 'ksef') && <div className="page-actions"><span className="muted">Okres</span>{wyborMiesiaca}</div>}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'ksef', label: 'KSeF', count: doWyslaniaKsef },
          ...(settings.vatowiec ? [{ id: 'jpk' as const, label: 'JPK_V7 (VAT)' }] : []),
          { id: 'zus', label: 'ZUS (DRA)' },
          { id: 'roczne', label: 'Ewidencje roczne' },
          { id: 'pomoc', label: 'Klucze i pomoc' },
        ]}
      />

      {tab === 'ksef' && (
        <div className="grid-2">
          <div className="stack">
            <KsefMasowa miesiac={miesiac} faktury={fakturyMiesiaca} />
            <KsefOdbior />
          </div>
          <KsefPolaczenie />
        </div>
      )}

      {tab === 'jpk' && (
        <div className="grid-2">
          <JpkWysylka miesiac={miesiac} kwartal={kwartal} />
          <Audyt miesiac={miesiac} sales={sales} settings={settings} />
        </div>
      )}

      {tab === 'zus' && (
        <DeklaracjeZus miesiace={[...miesiace].filter((m) => m < dzis.slice(0, 7)).slice(0, 12).reverse()} sales={sales} costs={costs} settings={settings} />
      )}

      {tab === 'roczne' && <EwidencjeRoczne />}

      {tab === 'pomoc' && <KluczeIPomoc />}
    </>
  );
}

function KsefPolaczenie(): JSX.Element {
  const { settings } = useStore();
  const [busy, setBusy] = useState(false);
  const [wynik, setWynik] = useState<{ ok: boolean; tekst: string } | null>(null);
  const sr = settings.ksefSrodowisko ?? 'test';

  async function sprawdz(): Promise<void> {
    setBusy(true);
    setWynik(null);
    try {
      const r = await api.ksef.sprawdz();
      setWynik({ ok: true, tekst: `Połączono (${r.srodowisko}): ${r.info}` });
    } catch (e) {
      setWynik({ ok: false, tekst: bladApi(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Połączenie z KSeF</h3>
        <Badge tone={sr === 'prod' ? 'red' : 'blue'}>{sr === 'prod' ? 'produkcja' : sr}</Badge>
      </div>
      <div className="stack">
        <Field label="Środowisko" hint={SRODOWISKA_KSEF.find((o) => o.value === sr)?.hint}>
          <select value={sr} onChange={(e) => updateSettings({ ksefSrodowisko: e.target.value as typeof sr })}>
            {SRODOWISKA_KSEF.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Token KSeF" hint="Aplikacja Podatnika KSeF → Tokeny (logowanie Profilem Zaufanym). Ważny do 31.12.2026 — potem certyfikat KSeF.">
          <input
            type="password"
            value={settings.ksefToken ?? ''}
            onChange={(e) => updateSettings({ ksefToken: e.target.value })}
            placeholder="Wklej token…"
            autoComplete="off"
          />
        </Field>
        <div>
          <button className="btn secondary" disabled={busy || !settings.ksefToken} onClick={() => void sprawdz()}>
            <Icon name="checkCircle" size={16} /> {busy ? 'Sprawdzanie…' : 'Sprawdź połączenie'}
          </button>
        </div>
        {wynik && <div className={wynik.ok ? 'ok-box' : 'err-box'}>{wynik.tekst}</div>}
        <div className="muted">
          Token zapisuje się tylko w Twojej bazie (ustawienia), nigdy w repozytorium. Faktury wysyłasz z panelu faktury
          („Wyślij do KSeF”) albo masowo powyżej.
        </div>
      </div>
    </div>
  );
}

/** Wysyłka JPK_V7M(3)/V7K(3) danymi autoryzującymi — podgląd XSD, wysyłka, status/UPO. */
function JpkWysylka({ miesiac, kwartal }: { miesiac: string; kwartal: string }): JSX.Element {
  const { settings } = useStore();
  const [kwartalny, setKwartalny] = useState(settings.okresVat === 'kwartalny');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [refNum, setRefNum] = useState('');
  // Dane autoryzujące — podpowiadane z Ustawień (Dane właściciela), edytowalne
  // per wysyłka; przychód sprzed 2 lat i tak podajesz za każdym razem (nie zapisywany).
  const [imie, setImie] = useState(settings.wlascicielImie ?? '');
  const [nazwisko, setNazwisko] = useState(settings.wlascicielNazwisko ?? '');
  const [dataUrodzenia, setDataUrodzenia] = useState(settings.wlascicielDataUrodzenia ?? '');
  useEffect(() => {
    if (!imie && settings.wlascicielImie) setImie(settings.wlascicielImie);
    if (!nazwisko && settings.wlascicielNazwisko) setNazwisko(settings.wlascicielNazwisko);
    if (!dataUrodzenia && settings.wlascicielDataUrodzenia) setDataUrodzenia(settings.wlascicielDataUrodzenia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wlascicielImie, settings.wlascicielNazwisko, settings.wlascicielDataUrodzenia]);
  const [telefon, setTelefon] = useState('');
  const [kodUrzedu, setKodUrzedu] = useState('');
  const [nipLubPesel, setNipLubPesel] = useState('');
  const [kwota, setKwota] = useState('');
  const [cel, setCel] = useState(1);
  const rokMinus2 = Number(miesiac.slice(0, 4)) - 2;

  const okresLabel = kwartalny ? kwartal.replace('-', ' ') : monthLabel(miesiac);
  const autoryzacjaOk = imie.trim() && nazwisko.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dataUrodzenia);
  // Podgląd wymaga kompletu danych firmy — te same pola, które backend wstawiłby
  // jako placeholdery (i zwrócił w `braki`). Bez tego przycisk jest zablokowany.
  const brakiUstawien: string[] = [];
  if (!settings.firmaNip || !czyNipPoprawny(settings.firmaNip)) brakiUstawien.push('NIP firmy');
  if (!(settings.firmaEmail ?? '').includes('@')) brakiUstawien.push('e-mail firmy');
  if (!/^\d{4}$/.test(settings.kodUrzedu ?? '')) brakiUstawien.push('kod urzędu skarbowego');
  if (!(settings.wlascicielImie ?? '').trim()) brakiUstawien.push('imię właściciela');
  if (!(settings.wlascicielNazwisko ?? '').trim()) brakiUstawien.push('nazwisko właściciela');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.wlascicielDataUrodzenia ?? '')) brakiUstawien.push('data urodzenia właściciela');
  const podgladZablokowany = brakiUstawien.length > 0;

  async function podglad(): Promise<void> {
    setBusy(true);
    setInfo(null);
    try {
      const r = await api.jpk.podglad(kwartalny ? undefined : miesiac, kwartalny ? kwartal : undefined);
      download(`JPK_${kwartalny ? 'V7K-' + kwartal : 'V7M-' + miesiac}.xml`, r.xml);
      const uwaga = r.uwaga ? ` ${r.uwaga}` : '';
      const pom = (r.pominiete ?? []).length > 0 ? ` Pominięto: ${(r.pominiete ?? []).join('; ')}.` : '';
      const braki = (r.braki ?? []).length > 0
        ? ` Do uzupełnienia przed wysyłką (w pliku są placeholdery): ${(r.braki ?? []).join('; ')}.`
        : '';
      if (r.walidacja.ok) {
        setInfo({ ok: true, tekst: `${r.formCode}: plik zgodny ze schematem MF.${pom}${braki}${uwaga}` });
        toast('Pobrano JPK — zgodny z XSD');
      } else if (r.walidacja.pominieta) {
        setInfo({ ok: true, tekst: `${r.formCode}: pobrano; walidacja XSD pominięta (${r.walidacja.bledy.slice(0, 2).join('; ')}).${pom}${braki}${uwaga}` });
      } else {
        setInfo({ ok: false, tekst: `${r.formCode}: niezgodny z XSD — ${r.walidacja.bledy.slice(0, 3).join('; ')}${pom}${braki}${uwaga}` });
      }
    } catch (e) {
      setInfo({ ok: false, tekst: `Podgląd: ${bladApi(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function wyslij(prod: boolean): Promise<void> {
    if (prod && !window.confirm(`Wysłać JPK za ${okresLabel} do Ministerstwa Finansów (produkcja)? To prawdziwa deklaracja VAT.`)) return;
    setBusy(true);
    setInfo(null);
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
          ? { ok: true, tekst: `Przyjęto — UPO pobrane. Numer referencyjny: ${r.referenceNumber}. ${r.opis}${pom}` }
          : { ok: r.kod < 400, tekst: `Bramka zwróciła kod ${r.kod}: ${r.opis} (ref ${r.referenceNumber})${pom}` },
      );
      if (r.upo) download(`UPO-JPK-${kwartalny ? kwartal : miesiac}.xml`, r.upo);
      if (r.kod === 200) toast(`JPK za ${okresLabel} przyjęty`);
    } catch (e) {
      setInfo({ ok: false, tekst: `Wysyłka: ${bladApi(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function sprawdzStatus(): Promise<void> {
    if (!refNum) return;
    setBusy(true);
    try {
      const s = await api.jpk.status(refNum, 'test');
      setInfo({ ok: true, tekst: `Status ${refNum}: ${JSON.stringify(s).slice(0, 400)}` });
    } catch (e) {
      setInfo({ ok: false, tekst: `Status: ${bladApi(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>JPK_V7 za {okresLabel}</h3>
          <p>Ewidencja + deklaracja VAT, termin: 25. dnia po okresie</p>
        </div>
        <label className="inline" title="Deklaracja kwartalna V7K (ewidencja z 3 miesięcy)">
          <input type="checkbox" checked={kwartalny} onChange={(e) => setKwartalny(e.target.checked)} />
          kwartalnie (V7K)
        </label>
      </div>
      {podgladZablokowany && (
        <div className="warn" style={{ marginBottom: 12 }}>
          Uzupełnij przed pobraniem JPK (<a href="#/ustawienia/firma">Ustawienia → Firma i faktury</a>):{' '}
          {brakiUstawien.join(', ')}.
        </div>
      )}
      <div className="stack">
        <div className="form-section">
          <h4><span className="chip-icon pit" style={{ width: 24, height: 24 }}>1</span> Sprawdź plik</h4>
          <div>
            <button
              className="btn secondary"
              disabled={busy || podgladZablokowany}
              title={podgladZablokowany ? `Brakuje: ${brakiUstawien.join(', ')}` : 'Pobierz JPK_V7 XML i zwaliduj ze schematem MF'}
              onClick={() => void podglad()}
            >
              <Icon name="download" size={15} /> Pobierz i zwaliduj XML
            </button>
          </div>
          {podgladZablokowany && (
            <div className="field-hint">Przycisk odblokuje się po uzupełnieniu braków z listy powyżej.</div>
          )}
        </div>
        <div className="form-section">
          <h4><span className="chip-icon pit" style={{ width: 24, height: 24 }}>2</span> Podpisz danymi autoryzującymi</h4>
          <p className="muted" style={{ margin: 0 }}>
            Bez kwalifikowanego podpisu: NIP/PESEL, imię, nazwisko, data urodzenia i przychód z zeznania za {rokMinus2} (0 gdy brak).
            Imię/nazwisko/datę podpowiadamy z Ustawień (Dane właściciela) — backend też ich użyje, gdy pole zostawisz puste.
          </p>
          <div className="form-grid-3">
            <Field label="Imię"><input value={imie} onChange={(e) => setImie(e.target.value)} autoComplete="off" /></Field>
            <Field label="Nazwisko"><input value={nazwisko} onChange={(e) => setNazwisko(e.target.value)} autoComplete="off" /></Field>
            <Field label="Data urodzenia"><input type="date" value={dataUrodzenia} onChange={(e) => setDataUrodzenia(e.target.value)} /></Field>
            <Field label="NIP albo PESEL"><input value={nipLubPesel} onChange={(e) => setNipLubPesel(e.target.value)} placeholder={settings.firmaNip ?? 'NIP/PESEL'} inputMode="numeric" /></Field>
            <Field label={`Przychód za ${rokMinus2}`}><input type="number" min={0} step="any" value={kwota} onChange={(e) => setKwota(e.target.value)} placeholder="z PIT za ten rok" /></Field>
            <Field label="Cel złożenia">
              <select value={cel} onChange={(e) => setCel(Number(e.target.value))}>
                <option value={1}>Złożenie</option>
                <option value={2}>Korekta</option>
              </select>
            </Field>
          </div>
          <details className="more">
            <summary><Icon name="chevronRight" size={15} /> Telefon i kod urzędu (opcjonalnie)</summary>
            <div className="form-grid-2">
              <Field label="Telefon"><input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder={settings.firmaTelefon ?? ''} /></Field>
              <Field label="Kod urzędu (nadpisuje Ustawienia)" hint="Zostaw puste, by użyć kodu z Ustawień.">
                <UrzadLookup value={kodUrzedu} onPick={setKodUrzedu} />
              </Field>
            </div>
          </details>
        </div>
        <div className="form-section">
          <h4><span className="chip-icon pit" style={{ width: 24, height: 24 }}>3</span> Wyślij</h4>
          <div className="btn-group">
            <button className="btn secondary" disabled={busy || !autoryzacjaOk} onClick={() => void wyslij(false)}>
              {busy ? 'Wysyłanie…' : 'Wyślij na środowisko testowe'}
            </button>
            <button className="btn" disabled={busy || !autoryzacjaOk} onClick={() => void wyslij(true)}>
              <Icon name="send" size={15} /> Wyślij do MF
            </button>
            {refNum && (
              <button className="btn ghost small" disabled={busy} onClick={() => void sprawdzStatus()}>
                Sprawdź status
              </button>
            )}
          </div>
          {!autoryzacjaOk && <div className="field-hint">Uzupełnij imię, nazwisko i datę urodzenia.</div>}
        </div>
        {info && <div className={info.ok ? 'ok-box' : 'err-box'}>{info.tekst}</div>}
      </div>
    </div>
  );
}

function EwidencjeRoczne(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const teraz = new Date().getFullYear();
  const [rok, setRok] = useState(String(teraz));
  const sumyRoczne = useMemo(
    () => Array.from({ length: 12 }, (_, i) => aggregateMonth(`${rok}-${String(i + 1).padStart(2, '0')}`, sales, costs, settings))
      .filter((s) => s.przychodNetto !== 0 || s.kosztyNettoPit !== 0),
    [rok, sales, costs, settings],
  );
  const srodkiTrwale: SrodekTrwaly[] = useMemo(() => {
    try {
      const raw = localStorage.getItem('frank-srodki-trwale');
      if (raw) return JSON.parse(raw) as SrodekTrwaly[];
    } catch { /* ignore */ }
    return [];
  }, []);
  const ryczalt = settings.formaOpodatkowania === 'ryczalt';
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Ewidencje w formie JPK</h3>
          <p>Od 2026 KPiR i ewidencję przychodów prowadzisz w postaci elektronicznej i wysyłasz na żądanie urzędu (za 2026 — w 2027).</p>
        </div>
        <select aria-label="Rok" className="compact" value={rok} onChange={(e) => setRok(e.target.value)}>
          {[teraz, teraz - 1, teraz - 2].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="btn-grid">
        {!ryczalt && (
          <button className="btn secondary" onClick={() => download(`JPK_PKPIR-${rok}.xml`, buildJpkPkpir(rok, sumyRoczne, {}).payload)}>
            <Icon name="download" size={15} /> JPK_PKPIR (księga)
          </button>
        )}
        {ryczalt && (
          <button className="btn secondary" onClick={() => download(`JPK_EWP-${rok}.xml`, buildJpkEwp(rok, sumyRoczne, {}).payload)}>
            <Icon name="download" size={15} /> JPK_EWP (ewidencja przychodów)
          </button>
        )}
        <button className="btn secondary" onClick={() => download(`JPK_ST-${rok}.xml`, buildJpkSt(srodkiDoJpk(srodkiTrwale, Number(rok)), {}).payload)}>
          <Icon name="download" size={15} /> JPK_ST (środki trwałe)
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{sumyRoczne.length} mies. z dokumentami w {rok}. Środki trwałe pochodzą z rejestru w zakładce Koszty → Majątek.</p>
    </div>
  );
}

function KluczeIPomoc(): JSX.Element {
  const { settings } = useStore();
  const mikro = settings.firmaNip && czyNipPoprawny(settings.firmaNip) ? mikrorachunek(settings.firmaNip) : null;
  return (
    <div className="grid-2">
      <div className="card">
        <h3>Klucze i rachunki</h3>
        <div className="stack">
          <Field label="Klucz API GUS BIR (wyszukiwanie firm po NIP)" hint="Bezpłatnie na api.stat.gov.pl. Biała Lista MF i NBP nie wymagają klucza.">
            <input value={settings.gusApiKey ?? ''} onChange={(e) => updateSettings({ gusApiKey: e.target.value })} placeholder="Klucz BIR…" autoComplete="off" />
          </Field>
          <Field label="Adres do e-Doręczeń" hint="Obowiązkowy wpis w CEIDG od 1.10.2026 (edoreczenia.gov.pl).">
            <input value={settings.edoreczeniaAdres ?? ''} onChange={(e) => updateSettings({ edoreczeniaAdres: e.target.value })} placeholder="AE:PL-…" />
          </Field>
          <div>
            <div className="dl-title">Mikrorachunek podatkowy (PIT, VAT)</div>
            {mikro ? (
              <div className="btn-group"><span className="mono">{mikro}</span><button className="btn ghost small icon-only" aria-label="Kopiuj" onClick={() => kopiuj(mikro)}><Icon name="copy" size={15} /></button></div>
            ) : <span className="muted">Uzupełnij NIP firmy.</span>}
            <div className="field-hint">Wyliczony z NIP — przed pierwszym przelewem porównaj z generatorem na podatki.gov.pl.</div>
          </div>
          <div>
            <div className="dl-title">Rachunek składkowy ZUS (NRS)</div>
            {settings.zusNrs ? (
              <div className="btn-group"><span className="mono">{settings.zusNrs}</span><button className="btn ghost small icon-only" aria-label="Kopiuj" onClick={() => kopiuj(settings.zusNrs ?? '')}><Icon name="copy" size={15} /></button></div>
            ) : <span className="muted">Uzupełnij w <a href="#/ustawienia/firma">Ustawieniach → Firma</a>.</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Jak to podłączyć</h3>
        <ol className="muted" style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <li><b>KSeF:</b> token z Aplikacji Podatnika (Profil Zaufany) → wklej w zakładce KSeF → „Sprawdź połączenie”. Zacznij od środowiska testowego.</li>
          <li><b>JPK_V7:</b> pobierz i zwaliduj plik, podpisz danymi autoryzującymi (imię, nazwisko, data urodzenia, przychód sprzed 2 lat) i wyślij. UPO pobiera się automatycznie.</li>
          <li><b>ZUS:</b> ZUS nie ma API do wysyłki — pobierz plik KEDU, zaimportuj w ePłatniku (PUE/eZUS), podpisz Profilem Zaufanym i wyślij do 20.</li>
          <li><b>GUS BIR:</b> klucz z api.stat.gov.pl (wyszukiwanie kontrahentów po NIP).</li>
          <li><b>Twój e-PIT:</b> zeznanie roczne 15 lutego – 30 kwietnia; kwoty w zakładce Podatki → PIT roczny.</li>
        </ol>
        <p className="muted" style={{ marginBottom: 0 }}>Pełna instrukcja krok po kroku: <span className="mono">docs/INTEGRACJE.md</span>.</p>
      </div>
    </div>
  );
}
