import { type JSX } from 'react';
import { pitRoczny } from '../../src-shared/tax/pit.js';
import { round2 } from '../../src-shared/tax/vat.js';
import { buildPitRocznyXmlFull } from '../../src-shared/tax/integrations.js';
import { dostepneLata, ustawRok, useRok, useStore } from '../lib/store.js';
import { useRozliczenie } from '../lib/rozliczenie.js';
import { useSubTab } from '../lib/router.js';
import { fmtMoney, monthLabel, todayISO } from '../lib/format.js';
import { Porownywarka } from './Porownywarka.js';
import { Ulgi } from './Ulgi.js';
import { UeVies } from './UeVies.js';
import { Icon, Tabs, toast } from './ui.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const ZAKLADKI = ['miesiace', 'roczny', 'porownanie', 'ue'] as const;
type Zakladka = (typeof ZAKLADKI)[number];

export function TaxesTab(): JSX.Element {
  const store = useStore();
  const { sales, costs, settings } = store;
  const rok = useRok();
  const lata = dostepneLata(store);
  if (!lata.includes(rok)) lata.unshift(rok);
  const [tab, setTab] = useSubTab<Zakladka>('podatki', ZAKLADKI, 'miesiace');
  const r = useRozliczenie(rok);
  const dzis = todayISO();
  const biezacy = dzis.slice(0, 7);

  const roczny = pitRoczny({
    przychod: r.przychod,
    koszty: r.koszty,
    zusSpoleczneRok: r.zusSpoleczne,
    zusZdrowotnaRok: r.zusZdrowotna,
    settings,
    ryczaltSplit: r.ryczaltSplit,
  });
  const doplata = round2(roczny.podatek - r.pitZaliczki);
  const pelnyRok = r.miesiace.length > 0 && r.miesiace[r.miesiace.length - 1].miesiac.endsWith('-12');
  const dochod = round2(r.przychod - r.koszty - r.zusSpoleczne);
  const ueCount = sales.filter((s) => s.dataSprzedazy.startsWith(`${rok}-`) && /^[A-Z]{2}/.test(s.kontrahent.nip) && !s.kontrahent.nip.startsWith('PL')).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Podatki</h2>
          <p>
            {settings.formaOpodatkowania === 'skala' ? 'Skala podatkowa' : settings.formaOpodatkowania === 'liniowy' ? 'Podatek liniowy' : 'Ryczałt'}
            {' • '}zaliczki PIT {r.kwartalnyPit ? 'kwartalne' : 'miesięczne'}
            {settings.vatowiec ? ` • VAT ${r.kwartalnyVat ? 'kwartalny (JPK_V7K)' : 'miesięczny (JPK_V7M)'}` : ' • zwolnienie z VAT'}
          </p>
        </div>
        <div className="page-actions">
          <select aria-label="Rok" className="compact" value={rok} onChange={(e) => ustawRok(Number(e.target.value))}>
            {lata.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Dochód {rok}</div>
          <div className="kpi-value">{fmtMoney(settings.formaOpodatkowania === 'ryczalt' ? r.przychod : dochod)}</div>
          <div className="kpi-sub">{settings.formaOpodatkowania === 'ryczalt' ? 'przychód (ryczałt bez kosztów)' : `przychód ${fmtMoney(r.przychod)} − koszty − społeczne`}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Zaliczki PIT</div>
          <div className="kpi-value">{fmtMoney(r.pitZaliczki)}</div>
          <div className="kpi-sub">efektywnie {r.przychod > 0 ? ((r.pitZaliczki / r.przychod) * 100).toFixed(1) : '0'}% przychodu</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">ZUS</div>
          <div className="kpi-value">{fmtMoney(r.zusRazem)}</div>
          <div className="kpi-sub">społeczne {fmtMoney(r.zusSpoleczne)} • zdrowotna {fmtMoney(r.zusZdrowotna)} • FP {fmtMoney(r.zusFp)}</div>
        </div>
        {settings.vatowiec && (
          <div className="kpi-card amber">
            <div className="kpi-label">VAT do zapłaty</div>
            <div className="kpi-value">{fmtMoney(r.vatDoZaplaty)}</div>
            <div className="kpi-sub">należny {fmtMoney(r.vatNalezny)} − naliczony {fmtMoney(r.vatNaliczony)}</div>
          </div>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'miesiace', label: 'Rozliczenie miesięczne' },
          { id: 'roczny', label: 'PIT roczny i ulgi' },
          { id: 'porownanie', label: 'Porównanie form' },
          { id: 'ue', label: 'Sprzedaż do UE', count: ueCount },
        ]}
      />

      {tab === 'miesiace' && (
        <div className="card flush">
          <div className="card-head">
            <div>
              <h3>Miesiąc po miesiącu</h3>
              <p>
                Zaliczka PIT liczona narastająco od początku roku; zdrowotna od dochodu z poprzedniego miesiąca;
                nadwyżka VAT przechodzi na kolejny okres.
              </p>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Miesiąc</th>
                  <th className="num">Przychód</th>
                  <th className="num">Koszty</th>
                  <th className="num">Dochód</th>
                  <th className="num">Społeczne</th>
                  <th className="num">Zdrowotna</th>
                  <th className="num">Zaliczka PIT</th>
                  {settings.vatowiec && <th className="num">VAT</th>}
                </tr>
              </thead>
              <tbody>
                {r.miesiace.map((m) => (
                  <tr key={m.miesiac} className={m.miesiac === biezacy ? 'selected' : ''}>
                    <td style={{ textTransform: 'capitalize' }}>{monthLabel(m.miesiac)}</td>
                    <td className="num">{fmtMoney(m.sums.przychodNetto)}</td>
                    <td className="num">{fmtMoney(m.sums.kosztyNettoPit)}</td>
                    <td className={`num${m.dochod < 0 ? ' text-red' : ''}`}>{fmtMoney(m.dochod)}</td>
                    <td className="num">{fmtMoney(m.zus.spoleczne + m.zus.fp)}</td>
                    <td className="num">{fmtMoney(m.zus.zdrowotna)}</td>
                    <td className="num">
                      {m.koniecOkresuPit ? <b>{fmtMoney(m.pit)}</b> : <span className="muted">kwartał</span>}
                    </td>
                    {settings.vatowiec && (
                      <td className="num">
                        {m.koniecOkresuVat ? (
                          <>
                            <b>{fmtMoney(m.vat)}</b>
                            {m.vatNadwyzka > 0 && <span className="sub">nadwyżka {fmtMoney(m.vatNadwyzka)}</span>}
                          </>
                        ) : <span className="muted">kwartał</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {r.miesiace.length > 0 && (
                <tfoot>
                  <tr>
                    <td>Razem</td>
                    <td className="num">{fmtMoney(r.przychod)}</td>
                    <td className="num">{fmtMoney(r.koszty)}</td>
                    <td className="num">{fmtMoney(dochod)}</td>
                    <td className="num">{fmtMoney(r.zusSpoleczne + r.zusFp)}</td>
                    <td className="num">{fmtMoney(r.zusZdrowotna)}</td>
                    <td className="num">{fmtMoney(r.pitZaliczki)}</td>
                    {settings.vatowiec && <td className="num">{fmtMoney(r.vatDoZaplaty)}</td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {tab === 'roczny' && (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Zeznanie roczne {roczny.formularz} za {rok}</h3>
                <p>{pelnyRok ? 'Pełny rok' : `Stan na dziś (${r.miesiace.length} mies.) — pełne liczby po grudniu`} • składasz w Twój e-PIT od 15 lutego do 30 kwietnia {rok + 1}</p>
              </div>
              <button
                className="btn secondary small"
                title="Roboczy XML z PIT/B i PIT-DS — do porównania z e-PIT"
                onClick={() => {
                  download(
                    `ePIT-${roczny.formularz}-${rok}.xml`,
                    buildPitRocznyXmlFull(roczny.formularz, String(rok), {
                      przychod: r.przychod,
                      koszty: r.koszty,
                      podatek: roczny.podatek,
                      danina: roczny.danina ?? 0,
                      pitB: [{ opis: 'Pozarolnicza działalność gospodarcza', przychod: r.przychod, koszty: r.koszty }],
                    }).payload,
                  );
                  toast('Pobrano roboczy XML zeznania');
                }}
              >
                <Icon name="download" size={15} /> XML roboczy
              </button>
            </div>
            <dl className="dl" style={{ maxWidth: 520 }}>
              <dt>Przychód</dt><dd>{fmtMoney(r.przychod)}</dd>
              {settings.formaOpodatkowania !== 'ryczalt' && <><dt>Koszty</dt><dd>{fmtMoney(r.koszty)}</dd></>}
              <dt>Odliczone składki</dt><dd>{fmtMoney(roczny.skladkiOdliczone)}</dd>
              <dt>Podstawa opodatkowania</dt><dd>{fmtMoney(roczny.podstawa)}</dd>
              <dt>Podatek należny</dt><dd><b>{fmtMoney(roczny.podatek)}</b></dd>
              <dt>Wpłacone zaliczki</dt><dd>{fmtMoney(r.pitZaliczki)}</dd>
              <dt style={{ fontWeight: 650, color: 'var(--text)' }}>{doplata >= 0 ? 'Do dopłaty' : 'Nadpłata'}</dt>
              <dd style={{ fontWeight: 700, fontSize: 16 }} className={doplata < 0 ? 'text-green' : ''}>{fmtMoney(Math.abs(doplata))}</dd>
            </dl>
            <p className="muted" style={{ marginBottom: 0 }}>{roczny.opis}.</p>
            {(roczny.danina ?? 0) > 0 && (
              <div className="warn" style={{ marginTop: 10 }}>
                Danina solidarnościowa (PIT-DS): <b>{fmtMoney(roczny.danina ?? 0)}</b> — 4% od dochodu ponad 1 mln zł.
              </div>
            )}
          </div>
          <Ulgi
            forma={settings.formaOpodatkowania}
            dochodSkala={Math.max(0, dochod)}
            przychodRoczny={r.przychod}
            stawkaRyczaltu={settings.stawkaRyczaltu}
            ryczaltSplit={r.ryczaltSplit}
            odliczenieRyczalt={round2(r.zusSpoleczne + r.zusZdrowotna * 0.5)}
            spoleczneRoczne={r.zusSpoleczne}
            zdrowotnaZapłacona={r.zusZdrowotna}
          />
        </>
      )}

      {tab === 'porownanie' && <Porownywarka rok={rok} sales={sales} costs={costs} settings={settings} dzis={dzis} />}

      {tab === 'ue' && <UeVies sales={sales} />}
    </>
  );
}
