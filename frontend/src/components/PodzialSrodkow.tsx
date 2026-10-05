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
  const vat = Math.max(0, p.vatDoZaplaty);
  const zysk = Math.max(0, p.przychodNetto - p.koszty - p.pit - vat - p.zusRazem);
  const oszczednosc = Math.max(0, p.pitBezKosztow - p.pit);
  const dane = [
    { nazwa: 'Zysk netto', wartosc: zysk, kolor: '#22c55e' },
    { nazwa: 'Koszty', wartosc: p.koszty, kolor: pal.cost },
    { nazwa: 'ZUS', wartosc: p.zusRazem, kolor: '#f59e0b' },
    { nazwa: 'PIT', wartosc: p.pit, kolor: pal.revenue },
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
        (bez kosztów: {fmtMoney(p.pitBezKosztow)}).
        {vat > 0 ? '' : ' VAT w nadpłacie — nie doliczono do tortu.'}
      </p>
    </div>
  );
}
