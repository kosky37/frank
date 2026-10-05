import type { JSX } from 'react';
import { porownajFormy } from '../../src-shared/tax/pit.js';
import { fmtMoney } from '../lib/format.js';

export interface PorownywarkaProps {
  przychod: number;
  koszty: number;
  zusSpoleczneRok: number;
  zusZdrowotnaRok: number;
  stawkaRyczaltu: number;
  ryczaltSplit?: { stawka: number; przychod: number }[];
}

export function Porownywarka({
  przychod,
  koszty,
  zusSpoleczneRok,
  zusZdrowotnaRok,
  stawkaRyczaltu,
  ryczaltSplit,
}: PorownywarkaProps): JSX.Element {
  const { skala, liniowy, ryczalt } = porownajFormy({
    przychod,
    koszty,
    zusSpoleczneRok,
    zusZdrowotnaRok,
    stawkaRyczaltu,
    ryczaltSplit,
  });
  const minPodatek = Math.min(skala.podatek, liniowy.podatek, ryczalt.podatek);
  const wiersze = [
    { nazwa: 'Skala (zasady ogólne)', wynik: skala },
    { nazwa: 'Liniowy 19%', wynik: liniowy },
    { nazwa: `Ryczałt ${(stawkaRyczaltu * 100).toFixed(stawkaRyczaltu < 0.1 ? 1 : 0)}%`, wynik: ryczalt },
  ];
  return (
    <div className="card">
      <h3>Porównywarka form opodatkowania</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Forma</th>
              <th>Formularz</th>
              <th className="num">Podatek</th>
              <th className="num">Efektywna stawka</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {wiersze.map((w) => {
              const best = w.wynik.podatek === minPodatek;
              return (
                <tr key={w.nazwa} className={best ? 'expanded' : ''}>
                  <td><b>{w.nazwa}</b></td>
                  <td>{w.wynik.formularz}</td>
                  <td className="num"><b>{fmtMoney(w.wynik.podatek)}</b></td>
                  <td className="num">{(w.wynik.efektywnaStawka * 100).toFixed(2)}%</td>
                  <td>{best ? <span className="badge green">najniższy PIT</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Ryczałt ignoruje koszty. Zdrowotna: skala — brak odliczenia od podatku,
        liniowy — odliczenie w limicie 14 100 zł/rok, ryczałt — 50% składki.
        Porównanie na tych samych danych rocznych; danina solidarnościowa (PIT-DS) liczona osobno.
      </p>
    </div>
  );
}
