import { useMemo, useState, type JSX } from 'react';
import { aggregateMonth } from '../../src-shared/tax/pit.js';
import { buildZusDraXml } from '../../src-shared/tax/integrations.js';
import type { CostInvoice, SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { zusKodTytulu, zusMiesieczny } from '../../src-shared/tax/zus.js';
import { useStore } from '../lib/store.js';
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

/** Deklaracje ZUS: lista miesięcznych DRA z XML, statusem i wysyłką do mocka/proda. */
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

  async function wyslijMock(m: string): Promise<void> {
    const w = wiersze.find((x) => x.miesiac === m);
    if (!w) return;
    setInfo('Wysyłanie…');
    try {
      const res = await fetch('/api/mock/zus/dra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          miesiac: m,
          spoleczne: w.zus.spoleczne,
          zdrowotna: w.zus.zdrowotna,
          nrs: settings.zusNrs ?? '',
          kodTytulu: settings.zusKodTytulu ?? zusKodTytulu(settings.zusSchemat),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { potwierdzenie: string };
      oznacz(m, `wyslana ${data.potwierdzenie}`);
      setInfo(`Wysłano DRA za ${m}: ${data.potwierdzenie}`);
    } catch {
      // tryb lokalny: zapisz jako wysłaną lokalnie
      oznacz(m, 'wyslana lokalnie (bez API)');
      setInfo('Brak API — oznaczono jako wysłaną lokalnie.');
    }
  }

  return (
    <div className="card">
      <h3>Deklaracje ZUS (DRA)</h3>
      <p className="muted">
        Termin: do 20. następnego miesiąca, jednym przelewem na NRS. Wakacje składkowe zerują
        społeczne + FP w danym miesiącu (zdrowotna zostaje). Kwoty są edytowalne — korekta
        (np. dobrowolne chorobowe) zapisuje się i trafia do XML.
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
                    {st.startsWith('wyslana') ? <Badge tone="green">{st}</Badge> : <Badge>{st}</Badge>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {w.poKorekcie && (
                      <button className="btn ghost small" onClick={() => resetKorekty(w.miesiac)}>
                        Cofnij
                      </button>
                    )}{' '}
                    <button
                      className="btn ghost small"
                      onClick={() =>
                        download(
                          `ZUS-DRA-${w.miesiac}.xml`,
                          buildZusDraXml(
                            w.miesiac,
                            { ...w.sums, zusSpoleczne: w.zus.spoleczne, zusZdrowotna: w.zus.zdrowotna },
                            settings.zusNrs ?? '',
                            settings.zusKodTytulu ?? zusKodTytulu(settings.zusSchemat), w.zus.fp,
                          ).payload,
                        )}
                    >
                      XML
                    </button>{' '}
                    <button className="btn ghost small" onClick={() => void wyslijMock(w.miesiac)}>
                      Wyślij
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {info && <p className="muted" style={{ marginTop: 8 }}>{info}</p>}
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
