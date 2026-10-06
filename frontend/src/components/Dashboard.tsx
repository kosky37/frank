import { useMemo, type JSX } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rozliczenieRoku } from '../../src-shared/tax/rok.js';
import { round2, salesVat } from '../../src-shared/tax/vat.js';
import { ryczaltZdrowotna } from '../../src-shared/tax/zus.js';
import { RATES_2026 } from '../../src-shared/tax/rates2026.js';
import { dostepneLata, ustawRok, useRok, useStore } from '../lib/store.js';
import { useTheme } from '../lib/theme.js';
import { useRozliczenie } from '../lib/rozliczenie.js';
import { navigate } from '../lib/router.js';
import { fmtMoney, formatDataPL, monthLabel, todayISO } from '../lib/format.js';
import { dniPoTerminie, marzaProcent, vatLimitProRata } from '../lib/quickwins.js';
import { Badge, chartPalette, Empty, Icon, Progress, type IconName } from './ui.js';
import { NajblizszePlatnosci } from './Terminy.js';
import { PodzialSrodkow } from './PodzialSrodkow.js';

const SKROTY = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function QuickAction({ icon, label, tone, onClick }: { icon: IconName; label: string; tone?: string; onClick: () => void }): JSX.Element {
  return (
    <button onClick={onClick}>
      <span className={`chip-icon ${tone ?? ''}`}><Icon name={icon} size={15} /></span>
      {label}
    </button>
  );
}

export function DashboardTab(): JSX.Element {
  const store = useStore();
  const { sales, costs, settings } = store;
  const theme = useTheme();
  const pal = chartPalette(theme);
  const rok = useRok();
  const lata = dostepneLata(store);
  if (!lata.includes(rok)) lata.unshift(rok);
  const dzis = todayISO();
  const r = useRozliczenie(rok);
  const pitBezKosztow = useMemo(
    () => rozliczenieRoku(rok, sales, [], settings, dzis).pitZaliczki,
    [rok, sales, settings, dzis],
  );

  const naReke = round2(r.przychod - r.kosztyGotowka - r.pitZaliczki - r.zusRazem);
  const marza = marzaProcent(naReke, r.przychod);
  const nMies = r.miesiace.length;
  // prognoza: średnia z miesięcy z fakturami lub zakończonych; pusty bieżący miesiąc liczy się jako pozostały
  const ostatni = r.miesiace[r.miesiace.length - 1];
  const biezacyPusty = !!ostatni && ostatni.miesiac === dzis.slice(0, 7) && ostatni.sums.przychodNetto === 0;
  const policzone = biezacyPusty ? r.miesiace.slice(0, -1) : r.miesiace;
  const sredniPrzychod = policzone.length > 0 ? r.przychod / policzone.length : 0;
  const pozostalo = ostatni ? 12 - Number(ostatni.miesiac.slice(5, 7)) + (biezacyPusty ? 1 : 0) : 0;
  const prognozaPrzychod = round2(r.przychod + sredniPrzychod * pozostalo);

  const nieoplacone = useMemo(
    () =>
      sales
        .filter((s) => s.status !== 'robocza' && s.rodzaj !== 'proforma' && !s.zaplacona)
        .sort((a, b) => a.terminPlatnosci.localeCompare(b.terminPlatnosci)),
    [sales],
  );
  const sumaNieoplacone = nieoplacone.reduce((a, s) => a + salesVat(s).brutto, 0);
  const poTerminie = nieoplacone.filter((s) => s.terminPlatnosci < dzis);

  const biezacy = r.miesiace.find((m) => m.miesiac === dzis.slice(0, 7)) ?? r.miesiace[r.miesiace.length - 1];
  const wykres = r.miesiace.map((m) => ({
    m: SKROTY[Number(m.miesiac.slice(5, 7)) - 1],
    przychod: m.sums.przychodNetto,
    koszty: m.sums.kosztyNettoPit,
    daniny: round2(m.pit + m.zus.razem),
  }));

  const vatLimit = vatLimitProRata(r.przychod, settings.dataRozpoczeciaDzialalnosci, rok);
  const dochodYtd = round2(r.przychod - r.koszty - r.zusSpoleczne);
  const przychodPoSpol = Math.max(0, round2(r.przychod - r.zusSpoleczne));
  const progRyczalt = przychodPoSpol <= 60000 ? 60000 : przychodPoSpol <= 300000 ? 300000 : null;

  const braki: { tekst: string; gdzie: string }[] = [];
  if (!settings.firmaNip || !settings.firmaNazwa) braki.push({ tekst: 'Dane firmy (nazwa, NIP, adres) — potrzebne na fakturach', gdzie: 'firma' });
  if (!settings.firmaRachunek) braki.push({ tekst: 'Rachunek bankowy do faktur', gdzie: 'firma' });
  if (!settings.zusNrs) braki.push({ tekst: 'Numer rachunku składkowego ZUS (NRS)', gdzie: 'firma' });
  if (settings.vatowiec && !settings.kodUrzedu) braki.push({ tekst: 'Kod urzędu skarbowego (do JPK_V7)', gdzie: 'firma' });

  const formaLabel = settings.formaOpodatkowania === 'skala' ? 'Skala podatkowa' : settings.formaOpodatkowania === 'liniowy' ? 'Podatek liniowy 19%' : `Ryczałt ${(settings.stawkaRyczaltu * 100).toFixed(settings.stawkaRyczaltu < 0.1 ? 1 : 0)}%`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Pulpit</h2>
          <p>{formaLabel} • {settings.vatowiec ? 'czynny podatnik VAT' : 'zwolniony z VAT'} • {nMies > 0 ? `${nMies} mies. rozliczenia ${rok}` : `brak okresów w ${rok}`}</p>
        </div>
        <div className="page-actions">
          <select aria-label="Rok" className="compact" value={rok} onChange={(e) => ustawRok(Number(e.target.value))}>
            {lata.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>

      <div className="quick" style={{ marginBottom: 16 }}>
        <QuickAction icon="plus" label="Wystaw fakturę" tone="roczny" onClick={() => navigate('sprzedaz', 'lista', 'nowa')} />
        <QuickAction icon="receipt" label="Dodaj koszt" tone="vat" onClick={() => navigate('koszty', 'lista', 'nowy')} />
        <QuickAction icon="download" label="Odbierz z KSeF" tone="pit" onClick={() => navigate('integracje', 'ksef')} />
        {settings.vatowiec && <QuickAction icon="send" label="Wyślij JPK_V7" tone="pit" onClick={() => navigate('integracje', 'jpk')} />}
        <QuickAction icon="shield" label="Deklaracja ZUS" tone="zus" onClick={() => navigate('integracje', 'zus')} />
      </div>

      {braki.length > 0 && (
        <div className="info" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon name="info" size={17} />
          <div style={{ flex: 1 }}>
            <b>Dokończ konfigurację:</b> {braki.map((b) => b.tekst).join(' • ')}
          </div>
          <a className="btn small secondary" href={`#/ustawienia/${braki[0].gdzie}`}>Uzupełnij</a>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi-card clickable" onClick={() => navigate('podatki')}>
          <div className="kpi-label">Przychód netto {rok}</div>
          <div className="kpi-value">{fmtMoney(r.przychod)}</div>
          <div className="kpi-sub">koszty {fmtMoney(r.koszty)} • dochód {fmtMoney(dochodYtd)}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Zostaje na rękę</div>
          <div className="kpi-value">{fmtMoney(naReke)}</div>
          <div className="kpi-sub">marża {marza.toFixed(0)}% • po kosztach, PIT i ZUS</div>
        </div>
        <div className="kpi-card amber clickable" onClick={() => navigate('terminy')}>
          <div className="kpi-label">PIT + ZUS + VAT {rok}</div>
          <div className="kpi-value">{fmtMoney(r.pitZaliczki + r.zusRazem + r.vatDoZaplaty)}</div>
          <div className="kpi-sub">PIT {fmtMoney(r.pitZaliczki)} • ZUS {fmtMoney(r.zusRazem)}{settings.vatowiec ? ` • VAT ${fmtMoney(r.vatDoZaplaty)}` : ''}</div>
        </div>
        <div className={`kpi-card ${poTerminie.length > 0 ? 'red' : 'plain'} clickable`} onClick={() => navigate('sprzedaz')}>
          <div className="kpi-label">Należności od klientów</div>
          <div className="kpi-value">{fmtMoney(sumaNieoplacone)}</div>
          <div className="kpi-sub">
            {nieoplacone.length === 0 ? 'wszystkie faktury opłacone' : `${nieoplacone.length} faktur${poTerminie.length > 0 ? ` • ${poTerminie.length} po terminie` : ''}`}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Do zapłaty</h3>
              <p>Najbliższe przelewy do US i ZUS, z kwotami z rozliczenia</p>
            </div>
            <a className="btn ghost small" href="#/terminy">Wszystkie terminy <Icon name="chevronRight" size={15} /></a>
          </div>
          <NajblizszePlatnosci pusto="Nic do zapłaty w najbliższych 5 tygodniach." />
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Odłóż z {biezacy ? monthLabel(biezacy.miesiac) : 'bieżącego miesiąca'}</h3>
              <p>Szacunek na podstawie dotychczasowych dokumentów</p>
            </div>
          </div>
          {biezacy ? (
            <dl className="dl">
              <dt>Przychód netto</dt><dd>{fmtMoney(biezacy.sums.przychodNetto)}</dd>
              <dt>Koszty (PIT)</dt><dd>{fmtMoney(biezacy.sums.kosztyNettoPit)}</dd>
              <dt>Zaliczka PIT</dt><dd>{r.kwartalnyPit && !biezacy.koniecOkresuPit ? <span className="muted">po kwartale</span> : fmtMoney(biezacy.pit)}</dd>
              <dt>ZUS</dt><dd>{fmtMoney(biezacy.zus.razem)}</dd>
              {settings.vatowiec && <><dt>VAT</dt><dd>{r.kwartalnyVat && !biezacy.koniecOkresuVat ? <span className="muted">po kwartale</span> : fmtMoney(biezacy.vat)}</dd></>}
              <dt style={{ fontWeight: 650, color: 'var(--text)' }}>Razem do odłożenia</dt>
              <dd style={{ fontWeight: 700, fontSize: 16 }}>{fmtMoney(biezacy.pit + biezacy.zus.razem + biezacy.vat)}</dd>
            </dl>
          ) : (
            <p className="muted">Brak danych.</p>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Przychody i koszty {rok}</h3>
            <span className="muted small">netto, miesięcznie</span>
          </div>
          {r.przychod === 0 && r.koszty === 0 ? (
            <Empty icon="trend" title="Brak dokumentów w tym roku" hint="Wykres pojawi się po wystawieniu faktury lub dodaniu kosztu." />
          ) : (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <BarChart data={wykres} barGap={2} margin={{ left: -8, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} stroke={pal.grid} />
                  <XAxis dataKey="m" tick={{ fill: pal.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: pal.tick, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip contentStyle={pal.tip} formatter={(v) => fmtMoney(Number(v))} cursor={{ fill: pal.grid, opacity: 0.4 }} />
                  <Bar dataKey="przychod" name="Przychód" fill={pal.revenue} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="koszty" name="Koszty" fill={pal.cost} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="daniny" name="PIT + ZUS" fill={pal.vatOut} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <PodzialSrodkow
          przychodNetto={r.przychod}
          koszty={r.kosztyGotowka}
          pit={r.pitZaliczki}
          zusRazem={r.zusRazem}
          pitBezKosztow={pitBezKosztow}
        />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Klienci — do zapłaty</h3>
            {nieoplacone.length > 0 && <a className="btn ghost small" href="#/sprzedaz">Faktury <Icon name="chevronRight" size={15} /></a>}
          </div>
          {nieoplacone.length === 0 ? (
            <div className="muted">Wszystkie wystawione faktury są opłacone.</div>
          ) : (
            <div className="list">
              {nieoplacone.slice(0, 6).map((s) => {
                const overdue = s.terminPlatnosci < dzis;
                return (
                  <a key={s.id} className="list-row" href={`#/sprzedaz/lista/${encodeURIComponent(s.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="main">
                      <b>{s.kontrahent.nazwa}</b>
                      <small>{s.numer} • termin {formatDataPL(s.terminPlatnosci)}</small>
                    </div>
                    {overdue ? <Badge tone="red">{dniPoTerminie(s.terminPlatnosci, dzis)} d po terminie</Badge> : <Badge tone="amber">oczekuje</Badge>}
                    <span className="amt">{fmtMoney(salesVat(s).brutto)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Limity i prognoza</h3>
          <div className="stack">
            {nMies > 0 && nMies < 12 && (
              <div>
                <div className="sidebar-row"><span className="muted">Prognoza przychodu {rok}</span><b>{fmtMoney(prognozaPrzychod)}</b></div>
                <div className="field-hint">średnio {fmtMoney(sredniPrzychod)} miesięcznie</div>
              </div>
            )}
            {!settings.vatowiec && (
              <div>
                <div className="sidebar-row"><span className="muted">Limit zwolnienia z VAT</span><span>{fmtMoney(r.przychod)} / {fmtMoney(vatLimit.limit)}</span></div>
                <div style={{ marginTop: 6 }}><Progress value={vatLimit.uzycie} tone={vatLimit.uzycie >= 0.9 ? 'red' : vatLimit.uzycie >= 0.75 ? 'amber' : undefined} /></div>
                {vatLimit.proRata && <div className="field-hint">limit proporcjonalny — działalność od {formatDataPL(settings.dataRozpoczeciaDzialalnosci ?? '')}</div>}
                {prognozaPrzychod > vatLimit.limit && !vatLimit.przekroczony && <div className="field-hint text-amber">Przy obecnym tempie przekroczysz limit przed końcem roku.</div>}
                {vatLimit.przekroczony && <div className="field-hint text-red">Limit przekroczony — zarejestruj się jako czynny podatnik VAT (VAT-R).</div>}
              </div>
            )}
            {settings.formaOpodatkowania === 'skala' && (
              <div>
                <div className="sidebar-row"><span className="muted">Próg 32% (dochód)</span><span>{fmtMoney(Math.max(0, dochodYtd))} / {fmtMoney(RATES_2026.skalaProg)}</span></div>
                <div style={{ marginTop: 6 }}><Progress value={dochodYtd / RATES_2026.skalaProg} tone={dochodYtd > RATES_2026.skalaProg ? 'red' : dochodYtd > RATES_2026.skalaProg * 0.8 ? 'amber' : undefined} /></div>
                {dochodYtd > RATES_2026.skalaProg && <div className="field-hint">Nadwyżka ponad próg opodatkowana 32% — porównaj formy w zakładce Podatki.</div>}
              </div>
            )}
            {settings.formaOpodatkowania === 'liniowy' && (
              <div>
                <div className="sidebar-row"><span className="muted">Odliczenie zdrowotnej (limit)</span><span>{fmtMoney(Math.min(r.zusZdrowotna, RATES_2026.liniowyZdrowotnaLimitRoczny))} / {fmtMoney(RATES_2026.liniowyZdrowotnaLimitRoczny)}</span></div>
                <div style={{ marginTop: 6 }}><Progress value={r.zusZdrowotna / RATES_2026.liniowyZdrowotnaLimitRoczny} /></div>
              </div>
            )}
            {settings.formaOpodatkowania === 'ryczalt' && (
              <div>
                <div className="sidebar-row">
                  <span className="muted">Próg zdrowotnej ryczałtu</span>
                  <span>{progRyczalt ? `${fmtMoney(przychodPoSpol)} / ${fmtMoney(progRyczalt)}` : 'najwyższy próg'}</span>
                </div>
                {progRyczalt && <div style={{ marginTop: 6 }}><Progress value={przychodPoSpol / progRyczalt} tone={przychodPoSpol / progRyczalt > 0.85 ? 'amber' : undefined} /></div>}
                <div className="field-hint">obecnie {fmtMoney(ryczaltZdrowotna(przychodPoSpol))} / mies.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
