import { useMemo, type JSX } from 'react';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { aggregateMonth, mergeRyczaltSplit, pitRoczny, pitZaliczkaMiesieczna } from '../../src-shared/tax/pit.js';
import { round2, salesVat, vatDue } from '../../src-shared/tax/vat.js';
import { ryczaltZdrowotna, zusMiesieczny } from '../../src-shared/tax/zus.js';
import { useStore } from '../lib/store.js';
import { useTheme } from '../lib/theme.js';
import { fmtMoney, monthLabel, todayISO } from '../lib/format.js';
import { dniPoTerminie, marzaProcent, prognozaRoku, vatLimitProRata } from '../lib/quickwins.js';
import { czyNipPoprawny, mikrorachunek } from '../../src-shared/tax/integrations.js';
import { Badge, chartPalette } from './ui.js';
import { Terminy } from './Terminy.js';
import { PodzialSrodkow } from './PodzialSrodkow.js';

function nextMonthKey(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function DashboardTab({ onGotoSales }: { onGotoSales: () => void }): JSX.Element {
  const { sales, costs, settings } = useStore();
  const theme = useTheme();
  const pal = chartPalette(theme);

  const miesiace = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((x) => s.add(x.dataSprzedazy.slice(0, 7)));
    costs.forEach((x) => s.add(x.dataKsiegowania.slice(0, 7)));
    if (s.size === 0) s.add(todayISO().slice(0, 7));
    return [...s].sort();
  }, [sales, costs]);
  const biezacy = miesiace[miesiace.length - 1];

  const sums = useMemo(
    () => miesiace.map((m) => aggregateMonth(m, sales, costs, settings)),
    [miesiace, sales, costs, settings],
  );
  const biezace = aggregateMonth(biezacy, sales, costs, settings);
  const dochodBiezacy = Math.max(0, biezace.przychodNetto - biezace.kosztyNettoPit - biezace.zusSpoleczne);
  const pit = pitZaliczkaMiesieczna(biezace, settings);
  const vat = settings.vatowiec ? vatDue(biezace.vatNalezny, biezace.vatNaliczony) : 0;
  const zus = zusMiesieczny(settings, dochodBiezacy, biezace.przychodNetto, biezacy);
  const rokPrzychod = sums.reduce((a, s) => a + s.przychodNetto, 0);
  const rokKoszty = sums.reduce((a, s) => a + s.kosztyNettoPit, 0);
  // FIX: roczny PIT liczony na YTD, nie x12. Wcześniej 1 mies. przychodu vs 12 mies. ZUS dawał 0 podatku.
  const zusSpolYtd = round2(sums.reduce((a, s) => a + s.zusSpoleczne, 0));
  const zusZdrYtd = (() => {
    let total = 0;
    for (const s of sums) {
      const dochod = Math.max(0, s.przychodNetto - s.kosztyNettoPit - s.zusSpoleczne);
      total += zusMiesieczny(settings, dochod, s.przychodNetto, s.miesiac).zdrowotna;
    }
    return round2(total);
  })();
  const zusYtd = (() => {
    let total = 0;
    for (const s of sums) {
      const dochod = Math.max(0, s.przychodNetto - s.kosztyNettoPit - s.zusSpoleczne);
      total += zusMiesieczny(settings, dochod, s.przychodNetto, s.miesiac).razem;
    }
    return round2(total);
  })();
  const miesiaceYtd = sums.length;
  const roczny = pitRoczny({
    przychod: rokPrzychod,
    koszty: rokKoszty,
    zusSpoleczneRok: zusSpolYtd,
    zusZdrowotnaRok: zusZdrYtd,
    settings,
    ryczaltSplit: mergeRyczaltSplit(sums),
  });

  const nieoplacone = useMemo(
    () =>
      sales
        .filter((s) => s.status !== 'robocza' && !s.zaplacona)
        .sort((a, b) => a.terminPlatnosci.localeCompare(b.terminPlatnosci)),
    [sales],
  );
  const sumaNieoplacone = nieoplacone.reduce((a, s) => a + salesVat(s).brutto, 0);
  const dzis = todayISO();
  const vatNaleznyYtd = sums.reduce((a, s) => a + s.vatNalezny, 0);
  const vatNaliczonyYtd = sums.reduce((a, s) => a + s.vatNaliczony, 0);
  const vatSaldoYtd = Math.max(0, vatNaleznyYtd - vatNaliczonyYtd);
  const naReke = rokPrzychod - rokKoszty - roczny.podatek - zusYtd - vatSaldoYtd;
  const pitBezKosztow = pitRoczny({
    przychod: rokPrzychod,
    koszty: 0,
    zusSpoleczneRok: zusSpolYtd,
    zusZdrowotnaRok: zusZdrYtd,
    settings,
    ryczaltSplit: mergeRyczaltSplit(sums),
  }).podatek;
  const vatLimit = vatLimitProRata(rokPrzychod, settings.dataRozpoczeciaDzialalnosci, Number(biezacy.slice(0, 4)));
  const vatLimitPct = Math.round(vatLimit.uzycie * 100);
  const nast = nextMonthKey(biezacy);
  const nastLabel = monthLabel(nast);
  // Prognoza liniowa do XII + marża + efektywna stawka PIT.
  const marza = marzaProcent(naReke, rokPrzychod);
  const efektywnaPct = (roczny.efektywnaStawka * 100).toFixed(1);
  const prognozaPrzychod = prognozaRoku(rokPrzychod, miesiaceYtd);
  const prognozaNaReke = prognozaRoku(naReke, miesiaceYtd);
  // Alert tieru zdrowotnej ryczałtu: ile brakuje do kolejnego progu (60k / 300k przychodu−społeczne).
  const przychodPoSpol = Math.max(0, round2(rokPrzychod - zusSpolYtd));
  const progTier = przychodPoSpol <= 60000 ? 60000 : przychodPoSpol <= 300000 ? 300000 : null;
  const tierInfo = settings.formaOpodatkowania === 'ryczalt'
    ? { miesieczna: ryczaltZdrowotna(przychodPoSpol), prog: progTier, brakuje: progTier !== null ? round2(progTier - przychodPoSpol) : 0 }
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Pulpit</h2>
          <p>
            {settings.formaOpodatkowania === 'skala' ? 'Zasady ogólne' : settings.formaOpodatkowania === 'liniowy' ? 'Podatek liniowy' : `Ryczałt ${(settings.stawkaRyczaltu * 100).toFixed(1)}%`}
            {' '}• {settings.vatowiec ? 'czynny VAT' : 'zwolnienie z VAT'}
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Przychód YTD netto ({miesiaceYtd} mies.)</div>
          <div className="kpi-value">{fmtMoney(rokPrzychod)}</div>
          <div className="kpi-sub">koszty PIT {fmtMoney(rokKoszty)} • ZUS YTD {fmtMoney(zusYtd)}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">PIT roczny YTD ({roczny.formularz})</div>
          <div className="kpi-value">{fmtMoney(roczny.podatek)}</div>
          <div className="kpi-sub">{roczny.opis} • YTD {miesiaceYtd} mies., pełny rok po XII</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">VAT {biezacy} do zapłaty</div>
          <div className="kpi-value">{fmtMoney(vat)}</div>
          <div className="kpi-sub">
            należny {fmtMoney(biezace.vatNalezny)} − naliczony {fmtMoney(biezace.vatNaliczony)}
          </div>
        </div>
        <div className="kpi-card red">
          <div className="kpi-label">Niezapłacone faktury</div>
          <div className="kpi-value">{fmtMoney(sumaNieoplacone)}</div>
          <div className="kpi-sub">
            {nieoplacone.length === 0 ? 'wszystko opłacone' : `${nieoplacone.length} szt. • ZUS mies. ${fmtMoney(zus.razem)}`}
          </div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Na rękę (szacunek YTD)</div>
          <div className="kpi-value">{fmtMoney(naReke)}</div>
          <div className="kpi-sub">
            przychód {fmtMoney(rokPrzychod)} − koszty {fmtMoney(rokKoszty)} − PIT {fmtMoney(roczny.podatek)} − ZUS YTD {fmtMoney(zusYtd)} − VAT {fmtMoney(vatSaldoYtd)}
          </div>
          <div className="kpi-sub">
            efektywna stawka PIT {efektywnaPct}% • marża {marza.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Ile do zapłaty i do kiedy</h3>
        <div className="unpaid">
          <div className="unpaid-row">
            <div className="who">
              <b>PIT zaliczka ({biezacy})</b>
              <small>
                {settings.zaliczkaPit === 'kwartalna' ? 'rozliczenie kwartalne' : 'rozliczenie miesięczne'} — do 20. {nastLabel}
                {(() => {
                  const nip = (settings.firmaNip ?? '').replace(/\D/g, '');
                  const mikro = nip.length === 10 && czyNipPoprawny(nip) ? mikrorachunek(nip) : null;
                  return mikro ? ` • mikrorachunek ${mikro}` : ' • uzupełnij NIP firmy, by pokazać mikrorachunek';
                })()}
              </small>
            </div>
            <span className="amt">{fmtMoney(pit.podatek)}</span>
          </div>
          <div className="unpaid-row">
            <div className="who">
              <b>ZUS za {biezacy}</b>
              <small>składki + DRA — do 20. {nastLabel}{settings.zusNrs ? ` • NRS ${settings.zusNrs}` : ' • uzupełnij NRS w Integracjach'}</small>
            </div>
            <span className="amt">{fmtMoney(zus.razem)}</span>
          </div>
          <div className="unpaid-row">
            <div className="who">
              <b>VAT za {biezacy}</b>
              <small>rozliczenie {settings.okresVat === 'miesieczny' ? 'miesięczne' : 'kwartalne'} — do 25. {nastLabel}</small>
            </div>
            <span className="amt">{fmtMoney(vat)}</span>
          </div>
          <div className="unpaid-row">
            <div className="who">
              <b>Roczny PIT YTD ({roczny.formularz})</b>
              <small>zeznanie + zapłata — do 30 kwietnia • YTD {miesiaceYtd} mies.</small>
            </div>
            <span className="amt">{fmtMoney(roczny.podatek)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Limit zwolnienia VAT {fmtMoney(vatLimit.limit)}</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          Wykorzystanie: {vatLimitPct}% ({fmtMoney(rokPrzychod)} / {fmtMoney(vatLimit.limit)})
          {vatLimit.proRata && ` • pro-rata: działalność od ${settings.dataRozpoczeciaDzialalnosci} (${vatLimit.dniAktywnosci} dni aktywności)`}
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(100, vatLimit.uzycie * 100)}%`,
              height: '100%',
              background: vatLimit.przekroczony || vatLimit.uzycie >= 0.9 ? 'var(--red)' : 'var(--accent)',
            }}
          />
        </div>
        {(vatLimit.przekroczony || vatLimit.uzycie >= 0.9) && (
          <div className="warn" style={{ marginTop: 8 }}>
            {vatLimit.przekroczony
              ? `Przekroczono limit ${fmtMoney(vatLimit.limit)} — konieczna rejestracja jako czynny podatnik VAT.`
              : `Zbliżasz się do limitu ${fmtMoney(vatLimit.limit)} (90%) — monitoruj sprzedaż.`}
          </div>
        )}
      </div>

      {miesiaceYtd < 12 && (
        <div className="card">
          <h3>Prognoza do końca roku (ekstrapolacja YTD)</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Na podstawie {miesiaceYtd} mies.: przychód ~<b>{fmtMoney(prognozaPrzychod)}</b> •
            na rękę ~<b>{fmtMoney(prognozaNaReke)}</b>
          </div>
          {tierInfo && (
            <div className={tierInfo.prog !== null && tierInfo.brakuje < prognozaPrzychod - rokPrzychod ? 'warn' : 'muted'} style={{ marginTop: 4 }}>
              Zdrowotna ryczałt: {fmtMoney(tierInfo.miesieczna)}/mies. (przychód−społeczne {fmtMoney(przychodPoSpol)})
              {tierInfo.prog !== null
                ? ` — do progu ${fmtMoney(tierInfo.prog)} brakuje ${fmtMoney(tierInfo.brakuje)}.`
                : ' — najwyższy próg (>300 tys.).'}
            </div>
          )}
        </div>
      )}

      <Terminy />

      <PodzialSrodkow
        przychodNetto={rokPrzychod}
        koszty={rokKoszty}
        pit={roczny.podatek}
        vatDoZaplaty={vatSaldoYtd}
        zusRazem={zusYtd}
        pitBezKosztow={pitBezKosztow}
      />

      {nieoplacone.length > 0 && (
        <div className="card">
          <h3>Do zapłaty przez klientów</h3>
          <div className="unpaid">
            {nieoplacone.slice(0, 6).map((s) => {
              const overdue = s.terminPlatnosci < dzis;
              const dni = overdue ? dniPoTerminie(s.terminPlatnosci, dzis) : 0;
              return (
                <div key={s.id} className="unpaid-row">
                  <div className="who">
                    <b>{s.numer}</b> — {s.kontrahent.nazwa}
                    <small>termin {s.terminPlatnosci}</small>
                  </div>
                  {overdue ? <Badge tone="red">po terminie {dni} d</Badge> : <Badge tone="amber">oczekuje</Badge>}
                  <span className="amt">{fmtMoney(salesVat(s).brutto)}</span>
                </div>
              );
            })}
          </div>
          {nieoplacone.length > 6 && (
            <button className="btn ghost small" style={{ marginTop: 8 }} onClick={onGotoSales}>
              Pokaż wszystkie ({nieoplacone.length}) →
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h3>Przychody vs koszty (netto)</h3>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={sums}>
              <CartesianGrid strokeDasharray="3 3" stroke={pal.grid} />
              <XAxis dataKey="miesiac" tick={{ fill: pal.tick, fontSize: 12 }} />
              <YAxis tick={{ fill: pal.tick, fontSize: 12 }} />
              <Tooltip contentStyle={pal.tip} formatter={(v) => fmtMoney(Number(v))} />
              <Legend />
              <Bar dataKey="przychodNetto" name="przychód" fill={pal.revenue} radius={[6, 6, 0, 0]} />
              <Bar dataKey="kosztyNettoPit" name="koszty PIT" fill={pal.cost} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>
          PIT zaliczka ({biezacy}): {fmtMoney(pit.podatek)}
        </h3>
        <div className="muted">{pit.opis}. Podstawa: {fmtMoney(pit.podstawa)}.</div>
        <div style={{ height: 240, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={sums}>
              <CartesianGrid strokeDasharray="3 3" stroke={pal.grid} />
              <XAxis dataKey="miesiac" tick={{ fill: pal.tick, fontSize: 12 }} />
              <YAxis tick={{ fill: pal.tick, fontSize: 12 }} />
              <Tooltip contentStyle={pal.tip} formatter={(v) => fmtMoney(Number(v))} />
              <Legend />
              <Bar dataKey="vatNalezny" name="VAT należny" fill={pal.vatIn} radius={[6, 6, 0, 0]} />
              <Bar dataKey="vatNaliczony" name="VAT naliczony" fill={pal.vatOut} radius={[6, 6, 0, 0]} />
              <Line dataKey="przychodNetto" name="przychód" stroke={pal.line} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
