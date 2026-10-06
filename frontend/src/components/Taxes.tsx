import { useMemo, useState, type JSX } from 'react';
import { aggregateMonth, aggregateQuarter, mergeRyczaltSplit, pitRoczny, pitZaliczkaMiesieczna } from '../../src-shared/tax/pit.js';
import { round2, vatDue } from '../../src-shared/tax/vat.js';
import { zusMiesieczny } from '../../src-shared/tax/zus.js';
import { buildPitRocznyXmlFull } from '../../src-shared/tax/integrations.js';
import { useStore } from '../lib/store.js';
import { fmtMoney, monthLabel, todayISO } from '../lib/format.js';
import { Porownywarka } from './Porownywarka.js';
import { Ulgi } from './Ulgi.js';
import { UeVies } from './UeVies.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const TERMIN_PIT_KW = ['20.04', '20.07', '20.10', '20.01'];
const TERMIN_VAT_KW = ['25.04', '25.07', '25.10', '25.01'];

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
  const dochodBiezacy = Math.max(0, biezace.przychodNetto - biezace.kosztyNettoPit - biezace.zusSpoleczne);
  const pit = pitZaliczkaMiesieczna(biezace, settings);
  const vat = settings.vatowiec ? vatDue(biezace.vatNalezny, biezace.vatNaliczony) : 0;
  const zus = zusMiesieczny(settings, dochodBiezacy, biezace.przychodNetto, miesiac);
  const rokPrzychod = sums.reduce((a, s) => a + s.przychodNetto, 0);
  const rokKoszty = sums.reduce((a, s) => a + s.kosztyNettoPit, 0);
  const rok = miesiac.slice(0, 4);
  const kwartaly = ([1, 2, 3, 4] as const).map((q) => {
    const qs = aggregateQuarter(rok, q, sales, costs, settings);
    return { q, qs, pit: pitZaliczkaMiesieczna(qs, settings), vat: settings.vatowiec ? vatDue(qs.vatNalezny, qs.vatNaliczony) : 0 };
  });
  // YTD, nie x12 (jak w Dashboard).
  const zusSpolYtd = round2(sums.reduce((a, s) => a + s.zusSpoleczne, 0));
  const zusZdrYtd = round2(
    sums.reduce((a, s) => {
      const dochod = Math.max(0, s.przychodNetto - s.kosztyNettoPit - s.zusSpoleczne);
      return a + zusMiesieczny(settings, dochod, s.przychodNetto, s.miesiac).zdrowotna;
    }, 0),
  );
  const roczny = pitRoczny({
    przychod: rokPrzychod,
    koszty: rokKoszty,
    zusSpoleczneRok: zusSpolYtd,
    zusZdrowotnaRok: zusZdrYtd,
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
          <select aria-label="Miesiąc rozliczenia" className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
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
        <div style={{ marginTop: 8 }}>
          <button
            className="btn secondary small"
            title="Roboczy XML z PIT/B, PIT/O i PIT-DS — wysyłka aktywnie w Twój e-PIT"
            onClick={() => download(
              `ePIT-${roczny.formularz}-${rok}.xml`,
              buildPitRocznyXmlFull(roczny.formularz, rok, {
                przychod: rokPrzychod,
                koszty: rokKoszty,
                podatek: roczny.podatek,
                danina: roczny.danina ?? 0,
                pitB: [{ opis: 'Pozarolnicza działalność gospodarcza', przychod: rokPrzychod, koszty: rokKoszty }],
              }).payload,
            )}
          >
            Pobierz e-PIT XML (roboczy)
          </button>
        </div>
      </div>

      <Ulgi
        forma={settings.formaOpodatkowania}
        dochodSkala={Math.max(0, rokPrzychod - rokKoszty - zusSpolYtd)}
        przychodRoczny={rokPrzychod}
        stawkaRyczaltu={settings.stawkaRyczaltu}
        ryczaltSplit={mergeRyczaltSplit(sums)}
        odliczenieRyczalt={round2(zusSpolYtd + zusZdrYtd * 0.5)}
        spoleczneRoczne={zusSpolYtd}
        zdrowotnaZapłacona={zusZdrYtd}
      />

      <UeVies sales={sales} />

      <Porownywarka
        przychod={rokPrzychod}
        koszty={rokKoszty}
        zusSpoleczneMies={settings.zusSpoleczneMies}
        zusFPMies={settings.zusFPMies}
        zdrowMinMies={settings.zusZdrowotnaMies}
        stawkaRyczaltu={settings.stawkaRyczaltu}
        ryczaltSplit={mergeRyczaltSplit(sums)}
        wakacje={!!settings.wakacjeSkladkoweMiesiac}
        miesiace={sums.length}
      />

      <div className="card">
        <h3>Rozliczenie kwartalne ({rok})</h3>
        {(settings.zaliczkaPit === 'kwartalna' || settings.okresVat === 'kwartalny') && (
          <p className="muted">
            Tryb kwartalny aktywny (PIT: {settings.zaliczkaPit}, VAT: {settings.okresVat}).
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kwartał</th><th className="num">Przychód</th><th className="num">PIT zaliczka (szac.)</th>
                <th className="num">VAT (szac.)</th><th>Terminy</th>
              </tr>
            </thead>
            <tbody>
              {kwartaly.map((k) => (
                <tr key={k.q}>
                  <td><b>Q{k.q}</b></td>
                  <td className="num">{fmtMoney(k.qs.przychodNetto)}</td>
                  <td className="num"><b>{fmtMoney(k.pit.podatek)}</b></td>
                  <td className="num">{fmtMoney(k.vat)}</td>
                  <td className="muted">PIT do {TERMIN_PIT_KW[k.q - 1]} • VAT do {TERMIN_VAT_KW[k.q - 1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Kwartalne zaliczki PIT (mały podatnik / start-up) i JPK_V7K: ewidencja co miesiąc,
          deklaracja + zapłata kwartalnie. ZUS zawsze miesięcznie do 20.
        </p>
      </div>
    </>
  );
}
