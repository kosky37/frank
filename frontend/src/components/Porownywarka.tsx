import type { JSX } from 'react';
import { porownajPelneObciazenie } from '../../src-shared/tax/pit.js';
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
}

export function Porownywarka(p: PorownywarkaProps): JSX.Element {
  const wynik = porownajPelneObciazenie({
    przychod: p.przychod,
    koszty: p.koszty,
    zusSpoleczneMies: p.zusSpoleczneMies,
    zusFPMies: p.zusFPMies,
    zdrowMinMies: p.zdrowMinMies,
    stawkaRyczaltu: p.stawkaRyczaltu,
    ryczaltSplit: p.ryczaltSplit,
    wakacje: p.wakacje,
  });
  const wiersze = [
    { nazwa: 'Skala (zasady ogólne)', ...wynik.skala },
    { nazwa: 'Liniowy 19%', ...wynik.liniowy },
    { nazwa: `Ryczałt ${(p.stawkaRyczaltu * 100).toFixed(p.stawkaRyczaltu < 0.1 ? 1 : 0)}%`, ...wynik.ryczalt },
  ];
  const minRazem = Math.min(...wiersze.map((w) => w.razem));
  return (
    <div className="card">
      <h3>Porównywarka: podatki + składki przy innej formie</h3>
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
        Szacunek na tych samych danych: ZUS liczony regułami formy
        (skala 9% / liniowy 4,9% dochodu, ryczałt tier z przychodu; min. roczne).
        Ryczałt ignoruje koszty. Zmiana formy: oświadczenie do US do 20. dnia miesiąca
        po pierwszym przychodzie w roku.
      </p>
    </div>
  );
}
