import { useState, type JSX } from 'react';
import { porownajPelneObciazenie } from '../../src-shared/tax/pit.js';
import { prognozaRoku } from '../lib/quickwins.js';
import { fmtMoney } from '../lib/format.js';

export interface PorownywarkaProps {
  przychod: number;
  koszty: number;
  zusSpoleczneMies: number;
  zusFPMies: number;
  zdrowMinMies: number;
  stawkaRyczaltu: number;
  ryczaltSplit?: { stawka: number; przychod: number }[];
  wakacje?: boolean;
  miesiace?: number;
}

export function Porownywarka(p: PorownywarkaProps): JSX.Element {
  const m = Math.max(1, Math.min(12, Math.round(p.miesiace ?? 12) || 12));
  const [prognoza, setPrognoza] = useState(false);
  // Prognoza do XII: liniowa ekstrapolacja YTD na 12 miesięcy.
  const przychod = prognoza ? prognozaRoku(p.przychod, m) : p.przychod;
  const koszty = prognoza ? prognozaRoku(p.koszty, m) : p.koszty;
  const split = prognoza && m < 12 && (p.ryczaltSplit?.length ?? 0) > 0
    ? (p.ryczaltSplit ?? []).map((s) => ({ stawka: s.stawka, przychod: prognozaRoku(s.przychod, m) }))
    : p.ryczaltSplit;
  const wynik = porownajPelneObciazenie({
    przychod,
    koszty,
    zusSpoleczneMies: p.zusSpoleczneMies,
    zusFPMies: p.zusFPMies,
    zdrowMinMies: p.zdrowMinMies,
    stawkaRyczaltu: p.stawkaRyczaltu,
    ryczaltSplit: split,
    wakacje: p.wakacje,
    miesiace: prognoza ? 12 : m,
  });
  const wiersze = [
    { nazwa: 'Skala (zasady ogólne)', ...wynik.skala },
    { nazwa: 'Liniowy 19%', ...wynik.liniowy },
    { nazwa: `Ryczałt ${(p.stawkaRyczaltu * 100).toFixed(p.stawkaRyczaltu < 0.1 ? 1 : 0)}%`, ...wynik.ryczalt },
  ];
  const minRazem = Math.min(...wiersze.map((w) => w.razem));
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Porównywarka: podatki + składki przy innej formie (YTD {m} mies.)</h3>
        <label className="inline" style={{ fontSize: 12 }} title="Ekstrapolacja YTD na pełne 12 miesięcy">
          <input type="checkbox" checked={prognoza} onChange={(e) => setPrognoza(e.target.checked)} />
          prognoza XII
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Forma</th>
              <th className="num">PIT</th>
              <th className="num">ZUS (rok)</th>
              <th className="num">Danina</th>
              <th className="num">Razem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {wiersze.map((w) => {
              const best = w.razem === minRazem;
              return (
                <tr key={w.nazwa} className={best ? 'expanded' : ''}>
                  <td><b>{w.nazwa}</b><div className="muted">{w.formularz}</div></td>
                  <td className="num">{fmtMoney(w.pit)}</td>
                  <td className="num">{fmtMoney(w.zus)}</td>
                  <td className="num">{w.danina > 0 ? fmtMoney(w.danina) : '—'}</td>
                  <td className="num"><b>{fmtMoney(w.razem)}</b></td>
                  <td>{best ? <span className="badge green">najniższe</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {prognoza ? 'Prognoza do XII (ekstrapolacja liniowa YTD)' : `Szacunek YTD na ${m} mies.`}: ZUS liczony regułami formy
        (skala 9% / liniowy 4,9% dochodu, ryczałt tier z przychodu; min. proporcjonalne do YTD).
        Ryczałt ignoruje koszty. Zmiana formy: oświadczenie do US do 20. dnia miesiąca
        po pierwszym przychodzie w roku.
      </p>
    </div>
  );
}
