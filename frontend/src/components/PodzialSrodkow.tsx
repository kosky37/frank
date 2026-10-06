import type { JSX } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { fmtMoney } from '../lib/format.js';
import { useTheme } from '../lib/theme.js';
import { chartPalette } from './ui.js';

export interface PodzialSrodkowProps {
  przychodNetto: number;
  koszty: number;
  pit: number;
  vatDoZaplaty: number;
  zusRazem: number;
  /** PIT policzony bez kosztów — do pokazania oszczędności */
  pitBezKosztow: number;
}

/** Tort: gdzie idą pieniądze — podatki, ZUS, koszty, zysk netto + oszczędność z kosztów. */
export function PodzialSrodkow(p: PodzialSrodkowProps): JSX.Element {
  const theme = useTheme();
  const pal = chartPalette(theme);
  const safe = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
  const przychod = safe(p.przychodNetto);
  const koszty = safe(p.koszty);
  const pit = safe(p.pit);
  const vat = safe(p.vatDoZaplaty);
  const zus = safe(p.zusRazem);
  const pitBez = safe(p.pitBezKosztow);
  const zysk = Math.max(0, przychod - koszty - pit - vat - zus);
  const oszczednosc = Math.max(0, pitBez - pit);
  const dane = [
    { nazwa: 'Zysk netto', wartosc: zysk, kolor: '#22c55e' },
    { nazwa: 'Koszty', wartosc: koszty, kolor: pal.cost },
    { nazwa: 'ZUS', wartosc: zus, kolor: '#f59e0b' },
    { nazwa: 'PIT', wartosc: pit, kolor: pal.revenue },
    { nazwa: 'VAT do zapłaty', wartosc: vat, kolor: pal.vatIn },
  ].filter((d) => d.wartosc > 0);
  return (
    <div className="card">
      <h3>Gdzie idą pieniądze (YTD)</h3>
      {dane.length === 0 ? (
        <p className="muted">Brak danych — wystaw pierwszą fakturę.</p>
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={dane} dataKey="wartosc" nameKey="nazwa" outerRadius={95} labelLine={false}>
                {dane.map((d) => (
                  <Cell key={d.nazwa} fill={d.kolor} />
                ))}
              </Pie>
              <Tooltip contentStyle={pal.tip} formatter={(v) => fmtMoney(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        Dzięki kosztom oszczędzasz <b>{fmtMoney(oszczednosc)}</b> PIT
        (bez kosztów: {fmtMoney(pitBez)}).
        {vat > 0 ? '' : ' VAT w nadpłacie — nie doliczono do tortu.'}
      </p>
      {dane.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Kategoria</th><th className="num">Kwota</th><th className="num">Udział</th></tr></thead>
            <tbody>
              {(() => {
                const total = dane.reduce((a, d) => a + d.wartosc, 0) || 1;
                return dane
                  .slice()
                  .sort((a, b) => b.wartosc - a.wartosc)
                  .map((d) => (
                    <tr key={d.nazwa}>
                      <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: d.kolor, marginRight: 8 }} />{d.nazwa}</td>
                      <td className="num">{fmtMoney(d.wartosc)}</td>
                      <td className="num">{Math.round((d.wartosc / total) * 100)}%</td>
                    </tr>
                  ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
