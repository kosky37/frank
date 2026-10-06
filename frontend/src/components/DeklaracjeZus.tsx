import { useEffect, useMemo, useState, type JSX } from 'react';
import { aggregateMonth } from '../../src-shared/tax/pit.js';
import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { zusKodTytulu, zusMiesieczny } from '../../src-shared/tax/zus.js';
import { useStore } from '../lib/store.js';
import { api, ApiError, type ZusPropozycja } from '../lib/api.js';
import { fmtMoney, monthLabel } from '../lib/format.js';
import { Badge } from './ui.js';

const KEY = 'frank-dra-status';
const KEY_KOREKTA = 'frank-korekta-dra';

function wczytajStatus(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function wczytajKorekty(): Record<string, { spoleczne: number; zdrowotna: number; fp: number }> {
  try {
    return JSON.parse(localStorage.getItem(KEY_KOREKTA) ?? '{}') as Record<
      string, { spoleczne: number; zdrowotna: number; fp: number }
    >;
  } catch {
    return {};
  }
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/xml;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bladApi(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : 'Nieznany błąd';
}

/** Deklaracje ZUS: miesięczne DRA z eksportem KEDU 5.6 do Płatnika/ePłatnika. */
export function DeklaracjeZus({
  miesiace,
  sales,
  costs,
  settings,
}: {
  miesiace: string[];
  sales: SalesInvoice[];
  costs: CostInvoice[];
  settings: TaxpayerSettings;
}): JSX.Element {
  const [statusy, setStatusy] = useState<Record<string, string>>(wczytajStatus);
  const [korekty, setKorekty] = useState(wczytajKorekty);
  const [info, setInfo] = useState('');
  const [eksportMiesiac, setEksportMiesiac] = useState<string | null>(null);

  const wiersze = useMemo(
    () =>
      miesiace.map((m) => {
        const sums = aggregateMonth(m, sales, costs, settings);
        const dochod = Math.max(0, sums.przychodNetto - sums.kosztyNettoPit - sums.zusSpoleczne);
        const wyliczony = zusMiesieczny(settings, dochod, sums.przychodNetto, m);
        // ręczna korekta deklaracji (np. dobrowolne chorobowe, zaokrąglenia Płatnika)
        const k = korekty[m];
        const zus = k ? { ...wyliczony, spoleczne: k.spoleczne, zdrowotna: k.zdrowotna, fp: k.fp, razem: k.spoleczne + k.zdrowotna + k.fp } : wyliczony;
        return { miesiac: m, sums, zus, poKorekcie: !!k };
      }),
    [miesiace, sales, costs, settings, korekty],
  );

  function zapiszKorekte(m: string, pole: 'spoleczne' | 'zdrowotna' | 'fp', wartosc: number): void {
    const w = wiersze.find((x) => x.miesiac === m);
    if (!w) return;
    const next = {
      ...korekty,
      [m]: { spoleczne: w.zus.spoleczne, zdrowotna: w.zus.zdrowotna, fp: w.zus.fp, [pole]: wartosc },
    };
    setKorekty(next);
    try {
      localStorage.setItem(KEY_KOREKTA, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function resetKorekty(m: string): void {
    const next = { ...korekty };
    delete next[m];
    setKorekty(next);
    try {
      localStorage.setItem(KEY_KOREKTA, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function oznacz(m: string, status: string): void {
    const next = { ...statusy, [m]: status };
    setStatusy(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card span-all">
      <h3>Deklaracje ZUS (DRA)</h3>
      <p className="muted">
        Termin: do 20. następnego miesiąca, jednym przelewem na NRS. ZUS nie udostępnia API
        do wysyłki — aplikacja generuje plik <b>KEDU 5.6</b>, który importujesz w Płatniku
        (Dokumenty wprowadzone → Importuj dokumenty) albo w ePłatniku (Import KEDU),
        tam podpisujesz Profilem Zaufanym i wysyłasz.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Miesiąc</th><th className="num">Społeczne</th><th className="num">Zdrowotna</th>
              <th className="num">FP</th><th className="num">Razem</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {wiersze.map((w) => {
              const st = statusy[w.miesiac] ?? 'robocza';
              const wakacje = settings.wakacjeSkladkoweMiesiac === w.miesiac;
              const num = (v: number, pole: 'spoleczne' | 'zdrowotna' | 'fp'): JSX.Element => (
                <input
                  type="number" min={0} step="any" value={v}
                  style={{ width: 92, textAlign: 'right' }}
                  onChange={(e) => zapiszKorekte(w.miesiac, pole, Number(e.target.value))}
                />
              );
              return (
                <tr key={w.miesiac}>
                  <td>
                    {monthLabel(w.miesiac)}
                    {wakacje && <span className="badge blue">wakacje</span>}
                    {w.poKorekcie && <span className="badge amber">korekta</span>}
                  </td>
                  <td className="num">{num(w.zus.spoleczne, 'spoleczne')}</td>
                  <td className="num">{num(w.zus.zdrowotna, 'zdrowotna')}</td>
                  <td className="num">{num(w.zus.fp, 'fp')}</td>
                  <td className="num"><b>{fmtMoney(w.zus.razem)}</b></td>
                  <td>
                    {st.startsWith('wyslana') || st.startsWith('zaimportowana') ? <Badge tone="green">{st}</Badge> : <Badge>{st}</Badge>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {w.poKorekcie && (
                      <button className="btn ghost small" onClick={() => resetKorekty(w.miesiac)}>
                        Cofnij
                      </button>
                    )}{' '}
                    <button
                      className="btn ghost small"
                      onClick={() => { setEksportMiesiac(w.miesiac); setInfo(''); }}
                    >
                      KEDU
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {eksportMiesiac && (
        <KeduEksport
          miesiac={eksportMiesiac}
          settings={settings}
          korekta={korekty[eksportMiesiac] ?? null}
          onZamknij={() => setEksportMiesiac(null)}
          onOznacz={(s) => oznacz(eksportMiesiac, s)}
        />
      )}
      {info && <p className="muted" style={{ marginTop: 8 }}>{info}</p>}
    </div>
  );
}

function PoleNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <label className="inline" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="muted">{label}</span>
      <input type="number" min={0} step="any" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 130 }} />
    </label>
  );
}

/** Panel eksportu KEDU dla miesiąca: propozycja z backendu → edycja → pobranie pliku. */
function KeduEksport({ miesiac, settings, korekta, onZamknij, onOznacz }: {
  miesiac: string;
  settings: TaxpayerSettings;
  korekta: { spoleczne: number; zdrowotna: number; fp: number } | null;
  onZamknij: () => void;
  onOznacz: (s: string) => void;
}): JSX.Element {
  const [prop, setProp] = useState<ZusPropozycja | null>(null);
  const [laduje, setLaduje] = useState(true);
  const [blad, setBlad] = useState('');
  const [imie, setImie] = useState('');
  const [nazwisko, setNazwisko] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    let aktywny = true;
    setLaduje(true);
    setBlad('');
    api.zus.keduPropozycja(miesiac)
      .then((p) => {
        if (!aktywny) return;
        // lokalna korekta z tabeli (zdrowotna/FP) ma pierwszeństwo nad propozycją
        if (korekta) {
          p = { ...p, zdrowotna: korekta.zdrowotna, fp: korekta.fp };
        }
        setProp({ ...p });
        setLaduje(false);
      })
      .catch((e: unknown) => { if (aktywny) { setBlad(bladApi(e)); setLaduje(false); } });
    return () => { aktywny = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miesiac]);

  function set<K extends keyof ZusPropozycja>(k: K, v: ZusPropozycja[K]): void {
    setProp((p) => (p ? { ...p, [k]: v } : p));
  }

  async function pobierz(): Promise<void> {
    if (!prop) return;
    setInfo('Budowanie KEDU…');
    try {
      const r = await api.zus.kedu({
        miesiac,
        emerytalne: prop.emerytalne,
        rentowe: prop.rentowe,
        chorobowe: prop.chorobowe,
        wypadkowe: prop.wypadkowe,
        zdrowotna: prop.zdrowotna,
        fp: prop.fp,
        podstawaEmerytalnaRentowa: prop.podstawaEmerytalnaRentowa,
        podstawaChorobowa: prop.podstawaChorobowa,
        podstawaWypadkowa: prop.podstawaWypadkowa,
        podstawaZdrowotna: prop.podstawaZdrowotna,
        stopaWypadkowa: prop.stopaWypadkowa,
        kodTytulu: prop.kodTytulu,
        imie: imie || undefined,
        nazwisko: nazwisko || undefined,
        dochodPoprzedniMiesiac: prop.dochodPoprzedniMiesiac,
        przychodYtd: prop.przychodYtd,
      });
      download(`KEDU-DRA-${miesiac}.xml`, r.xml);
      onOznacz('kedu pobrane (do importu w Płatniku)');
      setInfo(
        r.walidacja.ok
          ? 'KEDU zgodne ze schematem ZUS 5.6. Zaimportuj w Płatniku/ePłatniku, podpisz Profilem Zaufanym i wyślij.'
          : `Uwaga walidacji: ${r.walidacja.bledy.slice(0, 3).join('; ')} — sprawdź w Płatniku po imporcie.`,
      );
    } catch (e) {
      setInfo(`Błąd: ${bladApi(e)}`);
    }
  }

  if (laduje) return <p className="muted" style={{ marginTop: 8 }}>Liczenie propozycji DRA…</p>;
  if (blad) return <p className="warn" style={{ marginTop: 8 }}>Brak propozycji: {blad} <button className="btn ghost small" onClick={onZamknij}>Zamknij</button></p>;
  if (!prop) return <></>;

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <h4>Eksport KEDU — {monthLabel(miesiac)}</h4>
      <p className="muted">{prop.uwaga}</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <PoleNum label="Emerytalne" value={prop.emerytalne} onChange={(v) => set('emerytalne', v)} />
        <PoleNum label="Rentowe" value={prop.rentowe} onChange={(v) => set('rentowe', v)} />
        <PoleNum label="Chorobowe" value={prop.chorobowe} onChange={(v) => set('chorobowe', v)} />
        <PoleNum label="Wypadkowe" value={prop.wypadkowe} onChange={(v) => set('wypadkowe', v)} />
        <PoleNum label="Zdrowotna" value={prop.zdrowotna} onChange={(v) => set('zdrowotna', v)} />
        <PoleNum label="FP/FS" value={prop.fp} onChange={(v) => set('fp', v)} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <PoleNum label="Podstawa em./rent." value={prop.podstawaEmerytalnaRentowa} onChange={(v) => set('podstawaEmerytalnaRentowa', v)} />
        <PoleNum label="Podstawa chorob." value={prop.podstawaChorobowa} onChange={(v) => set('podstawaChorobowa', v)} />
        <PoleNum label="Podstawa wypadk." value={prop.podstawaWypadkowa} onChange={(v) => set('podstawaWypadkowa', v)} />
        <PoleNum label="Podstawa zdrowotna" value={prop.podstawaZdrowotna} onChange={(v) => set('podstawaZdrowotna', v)} />
        <PoleNum label="Stopa wypadkowa %" value={prop.stopaWypadkowa} onChange={(v) => set('stopaWypadkowa', v)} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <label className="inline" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted">Kod tytułu (domyślnie {settings.zusKodTytulu ?? zusKodTytulu(settings.zusSchemat)})</span>
          <input value={prop.kodTytulu} onChange={(e) => set('kodTytulu', e.target.value)} style={{ width: 130 }} />
        </label>
        <label className="inline" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted">Imię (blok II, opcjonalnie)</span>
          <input value={imie} onChange={(e) => setImie(e.target.value)} style={{ width: 150 }} />
        </label>
        <label className="inline" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted">Nazwisko (blok II, opcjonalnie)</span>
          <input value={nazwisko} onChange={(e) => setNazwisko(e.target.value)} style={{ width: 150 }} />
        </label>
        <PoleNum label="Dochód poprz. mies." value={prop.dochodPoprzedniMiesiac} onChange={(v) => set('dochodPoprzedniMiesiac', v)} />
        <PoleNum label="Przychód YTD" value={prop.przychodYtd} onChange={(v) => set('przychodYtd', v)} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => void pobierz()}>Pobierz KEDU</button>
        <button className="btn ghost" onClick={onZamknij}>Zamknij</button>
      </div>
      {info && <p className="muted" style={{ marginTop: 8 }}>{info}</p>}
      <ol className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
        <li>Płatnik: Dokumenty wprowadzone → Narzędzia → Importuj dokumenty → wskaż plik.</li>
        <li>ePłatnik (do 100 ubezpieczonych): Dokumenty ubezpieczeniowe → Import KEDU.</li>
        <li>Sprawdź kwoty, podpisz Profilem Zaufanym (bezpłatnie) i wyślij do 20. dnia miesiąca.</li>
      </ol>
    </div>
  );
}

export function useDeklaracjeZusData(): { miesiace: string[] } {
  const { sales, costs } = useStore();
  const miesiace = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    return [...s].sort();
  }, [sales, costs]);
  return { miesiace };
}
