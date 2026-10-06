import type { JSX } from 'react';
import { fmtMoney } from '../lib/format.js';

export interface PodzialSrodkowProps {
  przychodNetto: number;
  /** koszty faktycznie wydane (brutto − odzyskany VAT) */
  koszty: number;
  pit: number;
  zusRazem: number;
  /** PIT policzony bez kosztów — do pokazania oszczędności */
  pitBezKosztow: number;
}

/**
 * Gdzie idzie przychód netto: koszty, ZUS, PIT i to, co zostaje.
 * VAT nie wchodzi do podziału — jest doliczany do ceny i oddawany, nie jest przychodem.
 */
export function PodzialSrodkow(p: PodzialSrodkowProps): JSX.Element {
  const safe = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
  const przychod = safe(p.przychodNetto);
  const koszty = safe(p.koszty);
  const pit = safe(p.pit);
  const zus = safe(p.zusRazem);
  const zostaje = przychod - koszty - pit - zus;
  const oszczednosc = Math.max(0, safe(p.pitBezKosztow) - pit);
  const dane = [
    { nazwa: 'Zostaje Tobie', wartosc: Math.max(0, zostaje), kolor: 'var(--green)' },
    { nazwa: 'Koszty', wartosc: koszty, kolor: 'var(--border-strong)' },
    { nazwa: 'ZUS', wartosc: zus, kolor: 'var(--amber)' },
    { nazwa: 'PIT', wartosc: pit, kolor: 'var(--accent)' },
  ];
  const total = dane.reduce((a, d) => a + d.wartosc, 0) || 1;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Gdzie idzie przychód</h3>
        <span className="muted">{fmtMoney(przychod)} netto</span>
      </div>
      {przychod <= 0 ? (
        <p className="muted">Brak przychodu w tym roku — wystaw pierwszą fakturę.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-3)' }}>
            {dane.filter((d) => d.wartosc > 0).map((d) => (
              <div key={d.nazwa} title={`${d.nazwa}: ${fmtMoney(d.wartosc)}`} style={{ width: `${(d.wartosc / total) * 100}%`, background: d.kolor }} />
            ))}
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {dane.map((d) => (
              <div key={d.nazwa} className="list-row" style={{ padding: '7px 0' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: d.kolor, flexShrink: 0 }} />
                <div className="main">{d.nazwa}</div>
                <span className="muted">{Math.round((d.wartosc / total) * 100)}%</span>
                <span className="amt" style={{ minWidth: 110, textAlign: 'right' }}>{fmtMoney(d.wartosc)}</span>
              </div>
            ))}
          </div>
          {zostaje < 0 && <div className="warn" style={{ marginTop: 8 }}>Koszty i składki przewyższają przychód — strata {fmtMoney(-zostaje)}.</div>}
          {oszczednosc > 0 && (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Koszty obniżyły PIT o <b>{fmtMoney(oszczednosc)}</b>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
