import { useMemo, type JSX } from 'react';
import type { CostInvoice, SalesInvoice, TaxForm, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { rozliczenieRoku } from '../../src-shared/tax/rok.js';
import { round2 } from '../../src-shared/tax/vat.js';
import { fmtMoney } from '../lib/format.js';
import { Badge } from './ui.js';

/**
 * Porównanie form opodatkowania na tych samych dokumentach: dla każdej formy liczy się
 * pełne rozliczenie roku (zaliczki narastająco + zdrowotna wg zasad formy).
 */
export function Porownywarka({
  rok,
  sales,
  costs,
  settings,
  dzis,
}: {
  rok: number;
  sales: SalesInvoice[];
  costs: CostInvoice[];
  settings: TaxpayerSettings;
  dzis: string;
}): JSX.Element {
  const wiersze = useMemo(() => {
    const formy: { forma: TaxForm; nazwa: string }[] = [
      { forma: 'skala', nazwa: 'Skala 12% / 32%' },
      { forma: 'liniowy', nazwa: 'Liniowy 19%' },
      { forma: 'ryczalt', nazwa: `Ryczałt ${(settings.stawkaRyczaltu * 100).toFixed(settings.stawkaRyczaltu < 0.1 ? 1 : 0)}%` },
    ];
    return formy.map((f) => {
      const r = rozliczenieRoku(rok, sales, costs, { ...settings, formaOpodatkowania: f.forma }, dzis);
      const razem = round2(r.pitZaliczki + r.zusRazem);
      return { ...f, pit: r.pitZaliczki, zdrowotna: r.zusZdrowotna, spoleczne: round2(r.zusSpoleczne + r.zusFp), razem, naReke: round2(r.przychod - r.kosztyGotowka - razem), n: r.miesiace.length };
    });
  }, [rok, sales, costs, settings, dzis]);
  const min = Math.min(...wiersze.map((w) => w.razem));
  const obecna = wiersze.find((w) => w.forma === settings.formaOpodatkowania);
  const najlepsza = wiersze.find((w) => w.razem === min);
  const roznica = obecna && najlepsza ? round2(obecna.razem - najlepsza.razem) : 0;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Porównanie form opodatkowania {rok}</h3>
          <p>Te same dokumenty, inne zasady: PIT narastająco + zdrowotna właściwa dla formy ({wiersze[0]?.n ?? 0} mies.)</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Forma</th>
              <th className="num">PIT</th>
              <th className="num">Zdrowotna</th>
              <th className="num">Społeczne + FP</th>
              <th className="num">Razem</th>
              <th className="num">Na rękę</th>
            </tr>
          </thead>
          <tbody>
            {wiersze.map((w) => (
              <tr key={w.forma} className={w.forma === settings.formaOpodatkowania ? 'selected' : ''}>
                <td>
                  <b>{w.nazwa}</b>{' '}
                  {w.forma === settings.formaOpodatkowania && <Badge tone="blue">Twoja</Badge>}{' '}
                  {w.razem === min && <Badge tone="green">najtaniej</Badge>}
                </td>
                <td className="num">{fmtMoney(w.pit)}</td>
                <td className="num">{fmtMoney(w.zdrowotna)}</td>
                <td className="num">{fmtMoney(w.spoleczne)}</td>
                <td className="num"><b>{fmtMoney(w.razem)}</b></td>
                <td className="num">{fmtMoney(w.naReke)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {roznica > 0 && najlepsza && (
        <div className="info" style={{ marginTop: 12 }}>
          Na tych danych {najlepsza.nazwa.toLowerCase()} byłby tańszy o <b>{fmtMoney(roznica)}</b>. Zmianę formy zgłaszasz
          w CEIDG do 20. dnia miesiąca po pierwszym przychodzie w roku (albo do końca roku, jeśli pierwszy przychód był w grudniu).
        </div>
      )}
      <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Ryczałt nie uwzględnia kosztów; skala pozwala na wspólne rozliczenie i ulgę na dzieci (zakładka „PIT roczny”).
      </p>
    </div>
  );
}
