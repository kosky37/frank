import { useMemo, useState, type JSX } from 'react';
import { aggregateMonth, mergeRyczaltSplit, pitRoczny, pitZaliczkaMiesieczna } from '../../src-shared/tax/pit.js';
import { vatDue } from '../../src-shared/tax/vat.js';
import { buildJpkV7Stub, buildZusDeklaracjaStub } from '../../src-shared/tax/integrations.js';
import { zusMiesieczny } from '../../src-shared/tax/zus.js';
import { useStore } from '../lib/store.js';
import { fmtMoney, monthLabel, todayISO } from '../lib/format.js';
import { Porownywarka } from './Porownywarka.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function TaxesTab(): JSX.Element {
  const { sales, costs, settings } = useStore();
  const miesiace = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    if (s.size === 0) s.add(todayISO().slice(0, 7));
    return [...s].sort();
  }, [sales, costs]);
  const [miesiac, setMiesiac] = useState(miesiace[miesiace.length - 1] ?? todayISO().slice(0, 7));

  const sums = useMemo(
    () => miesiace.map((m) => aggregateMonth(m, sales, costs, settings)),
    [miesiace, sales, costs, settings],
  );
  const biezace =
    sums.find((s) => s.miesiac === miesiac) ?? aggregateMonth(miesiac, sales, costs, settings);
  const pit = pitZaliczkaMiesieczna(biezace, settings);
  const vat = settings.vatowiec ? vatDue(biezace.vatNalezny, biezace.vatNaliczony) : 0;
  const zus = zusMiesieczny(settings);
  const rokPrzychod = sums.reduce((a, s) => a + s.przychodNetto, 0);
  const rokKoszty = sums.reduce((a, s) => a + s.kosztyNettoPit, 0);
  const roczny = pitRoczny({
    przychod: rokPrzychod,
    koszty: rokKoszty,
    zusSpoleczneRok: settings.zusSpoleczneMies * 12,
    zusZdrowotnaRok: settings.zusZdrowotnaMies * 12,
    settings,
    ryczaltSplit: mergeRyczaltSplit(sums),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Podatki i deklaracje</h2>
          <p>Zaliczki miesięczne, ZUS i roczny PIT na podstawie zaksięgowanych dokumentów.</p>
        </div>
        <div className="page-actions">
          <select className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
            {miesiace.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card amber">
          <div className="kpi-label">VAT do zapłaty ({miesiac})</div>
          <div className="kpi-value">{fmtMoney(vat)}</div>
          <div className="kpi-sub">
            rozliczenie {settings.okresVat === 'miesieczny' ? 'miesięczne' : 'kwartalne'} •{' '}
            {vat > 0 ? 'do zapłaty' : vat < 0 ? `nadpłata ${fmtMoney(-vat)}` : 'zero do zapłaty'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">PIT zaliczka</div>
          <div className="kpi-value">{fmtMoney(pit.podatek)}</div>
          <div className="kpi-sub">{pit.opis}</div>
          {settings.zaliczkaPit === 'kwartalna' && (
            <div className="kpi-sub" style={{ marginTop: 6 }}>
              Zaliczka kwartalna: płatna do 20. miesiąca po zakończeniu kwartału.
            </div>
          )}
          {settings.formaOpodatkowania === 'ryczalt' && biezace.ryczaltSplit.length > 0 && (
            <div className="kpi-sub" style={{ marginTop: 6 }}>
              {biezace.ryczaltSplit
                .sort((a, b) => b.stawka - a.stawka)
                .map((p) => `${(p.stawka * 100).toFixed(p.stawka < 0.1 ? 1 : 0)}%: ${fmtMoney(p.przychod)}`)
                .join(' • ')}
            </div>
          )}
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">ZUS razem</div>
          <div className="kpi-value">{fmtMoney(zus.razem)}</div>
          <div className="kpi-sub">
            {fmtMoney(zus.spoleczne)} + {fmtMoney(zus.zdrowotna)} + FP {fmtMoney(zus.fp)}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Zestawienie miesięczne</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Miesiąc</th><th className="num">Przychód</th><th className="num">Koszty PIT</th>
                <th className="num">VAT należny</th><th className="num">VAT naliczony</th><th className="num">PIT zaliczka</th>
              </tr>
            </thead>
            <tbody>
              {sums.map((s) => (
                <tr key={s.miesiac} className={s.miesiac === miesiac ? 'expanded' : ''}>
                  <td>{monthLabel(s.miesiac)}</td>
                  <td className="num">{fmtMoney(s.przychodNetto)}</td>
                  <td className="num">{fmtMoney(s.kosztyNettoPit)}</td>
                  <td className="num">{fmtMoney(s.vatNalezny)}</td>
                  <td className="num">{fmtMoney(s.vatNaliczony)}</td>
                  <td className="num"><b>{fmtMoney(pitZaliczkaMiesieczna(s, settings).podatek)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Roczny PIT — {roczny.formularz}</h3>
        <div>
          Podstawa: {fmtMoney(roczny.podstawa)} • Podatek: <b>{fmtMoney(roczny.podatek)}</b>
        </div>
        <div className="muted">
          {roczny.opis}. Odliczone składki: {fmtMoney(roczny.skladkiOdliczone)}.
        </div>
        {(roczny.danina ?? 0) > 0 && (
          <div className="warn" style={{ marginTop: 8 }}>
            Danina solidarnościowa (PIT-DS): <b>{fmtMoney(roczny.danina ?? 0)}</b> — 4% od nadwyżki
            dochodu powyżej 1 mln zł.
          </div>
        )}
        {settings.formaOpodatkowania === 'skala' && rokPrzychod - rokKoszty > 120000 && (
          <div className="warn" style={{ marginTop: 8 }}>
            Przekroczony próg 120 tys. — nadwyżka liczona stawką 32%.
          </div>
        )}
      </div>

      <Porownywarka
        przychod={rokPrzychod}
        koszty={rokKoszty}
        zusSpoleczneRok={settings.zusSpoleczneMies * 12}
        zusZdrowotnaRok={settings.zusZdrowotnaMies * 12}
        stawkaRyczaltu={settings.stawkaRyczaltu}
        ryczaltSplit={mergeRyczaltSplit(sums)}
      />

      <div className="card">
        <h3>Deklaracje / integracje</h3>
        <div className="row">
          <button
            className="btn"
            onClick={() => download(`JPK_V7M-${miesiac}.xml`, buildJpkV7Stub(miesiac, sales, costs, biezace).payload)}
          >
            Pobierz JPK_V7M XML (stub)
          </button>
          <button
            className="btn secondary"
            onClick={() => download(`ZUS-${miesiac}.json`, buildZusDeklaracjaStub(miesiac, biezace).payload)}
          >
            Pobierz ZUS DRA (stub)
          </button>
        </div>
        <p className="muted">
          Docelowo: KSeF 2.0 (token + certyfikat), JPK_V7M/K wg XSD MF + podpis kwalifikowany, eZUS/PUE.
          Wysyłka pojedynczych faktur do KSeF dostępna jest z poziomu listy faktur.
        </p>
        <pre>{buildJpkV7Stub(miesiac, sales, costs, biezace).payload.slice(0, 1200)}</pre>
      </div>
    </>
  );
}
