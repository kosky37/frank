// Symulator „etat vs B2B”: koszt pracodawcy (brutto + ~20,48% ZUS) vs pełne
// obciążenie JDG (PIT+ZUS+danina) z porównywarki na żywych danych.
import { useState, type JSX } from 'react';
import { porownajPelneObciazenie } from '../../src-shared/tax/pit.js';
import { useStore } from '../lib/store.js';
import { fmtMoney } from '../lib/format.js';
import { kosztPracodawcy } from '../lib/quickwins.js';

export function EtatVsB2b(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const [brutto, setBrutto] = useState(20000);

  const miesiace = new Set<string>();
  sales.forEach((x) => miesiace.add(x.dataSprzedazy.slice(0, 7)));
  costs.forEach((x) => miesiace.add(x.dataKsiegowania.slice(0, 7)));
  const m = Math.max(1, miesiace.size);
  const przychodMies = sales
    .filter((s) => s.status !== 'robocza' && s.rodzaj !== 'proforma')
    .reduce((a, s) => a + s.pozycje.reduce((x, p) => x + p.ilosc * p.cenaNetto, 0), 0) / m;

  const etat = kosztPracodawcy(brutto);
  const b2b = porownajPelneObciazenie({
    przychod: Math.round(przychodMies * 12),
    koszty: 0,
    zusSpoleczneMies: settings.zusSpoleczneMies,
    zusFPMies: settings.zusFPMies,
    zdrowMinMies: settings.zusZdrowotnaMies,
    stawkaRyczaltu: settings.stawkaRyczaltu,
    miesiace: 12,
  });
  const forma = settings.formaOpodatkowania === 'skala' ? b2b.skala : settings.formaOpodatkowania === 'liniowy' ? b2b.liniowy : b2b.ryczalt;
  const naRekeB2b = Math.round(przychodMies * 12) - forma.pit - forma.zus - forma.danina;

  return (
    <div className="card">
      <h3>Etat vs B2B (magnes na nowych)</h3>
      <div className="row">
        <div>
          <label className="muted" htmlFor="etat-brutto">Brutto na etacie (mies.)</label>
          <input id="etat-brutto" type="number" min={0} step="any" value={brutto} onChange={(e) => setBrutto(Number(e.target.value))} style={{ maxWidth: 160 }} />
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>Wariant</th><th className="num">Koszt / przychód roczny</th><th className="num">Obciążenia</th><th className="num">Zostaje</th></tr></thead>
          <tbody>
            <tr>
              <td><b>Etat</b><div className="muted">brutto {fmtMoney(brutto)}/mies.</div></td>
              <td className="num">{fmtMoney(etat.kosztCalkowity * 12)}</td>
              <td className="num">ZUS pracodawcy {fmtMoney(etat.zusPracodawcy * 12)} (+ PIT pracownika w wypłacie)</td>
              <td className="num"><b>{fmtMoney(brutto * 12)}</b> brutto</td>
            </tr>
            <tr>
              <td><b>B2B ({settings.formaOpodatkowania})</b><div className="muted">śr. faktura {fmtMoney(Math.round(przychodMies))}/mies.</div></td>
              <td className="num">{fmtMoney(Math.round(przychodMies * 12))}</td>
              <td className="num">PIT {fmtMoney(forma.pit)} + ZUS {fmtMoney(forma.zus)}{forma.danina > 0 ? ` + danina ${fmtMoney(forma.danina)}` : ''}</td>
              <td className="num"><b>{fmtMoney(naRekeB2b)}</b> na rękę</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Szacunek: etat bez PPK/ulg; B2B bez kosztów, na Twojej formie i składkach z Ustawień.
        Ex-pracodawca na B2B: brak ulg ZUS + ryzyko uznania za etat (PIP) — skonsultuj umowę.
      </p>
    </div>
  );
}
