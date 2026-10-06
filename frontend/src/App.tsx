import { useEffect, useMemo, useState, type JSX } from 'react';
import { initStore, useBackend, useStore } from './lib/store.js';
import { toggleTheme, useTheme } from './lib/theme.js';
import { navigate, useRoute, type Page } from './lib/router.js';
import { useZobowiazania } from './lib/rozliczenie.js';
import { useOdhaczone } from './lib/terminy.js';
import { addDaysISO, todayISO } from './lib/format.js';
import { DashboardTab } from './components/Dashboard.js';
import { Onboarding, onboardingZakonczony } from './components/Onboarding.js';
import { SalesTab } from './components/Sales.js';
import { CostsTab } from './components/Costs.js';
import { ContractorsTab } from './components/Contractors.js';
import { TaxesTab } from './components/Taxes.js';
import { SettingsTab } from './components/Settings.js';
import { IntegracjeTab } from './components/Integracje.js';
import { EtatVsB2b } from './components/EtatVsB2b.js';
import { Cykliczne } from './components/Cykliczne.js';
import { TerminyPage } from './components/Terminy.js';
import { Icon, Toaster, type IconName } from './components/ui.js';
import './styles.css';

const NAV: { id: Page; label: string; section: string; icon: IconName }[] = [
  { id: 'pulpit', label: 'Pulpit', section: '', icon: 'home' },
  { id: 'sprzedaz', label: 'Sprzedaż', section: 'Dokumenty', icon: 'invoice' },
  { id: 'koszty', label: 'Koszty', section: 'Dokumenty', icon: 'receipt' },
  { id: 'kontrahenci', label: 'Kontrahenci', section: 'Dokumenty', icon: 'users' },
  { id: 'podatki', label: 'Podatki', section: 'Rozliczenia', icon: 'calculator' },
  { id: 'terminy', label: 'Terminy i płatności', section: 'Rozliczenia', icon: 'calendar' },
  { id: 'integracje', label: 'e-Urząd (KSeF, JPK, ZUS)', section: 'Rozliczenia', icon: 'send' },
  { id: 'narzedzia', label: 'Symulatory', section: 'Narzędzia', icon: 'sliders' },
  { id: 'ustawienia', label: 'Ustawienia', section: 'Narzędzia', icon: 'settings' },
];

function useLiczniki(): Partial<Record<Page, { n: number; tone: 'red' | 'amber' | '' }>> {
  const { sales } = useStore();
  const zob = useZobowiazania();
  const odh = useOdhaczone();
  return useMemo(() => {
    const dzis = todayISO();
    const poTerminie = sales.filter((s) => s.status !== 'robocza' && s.rodzaj !== 'proforma' && !s.zaplacona && s.terminPlatnosci < dzis).length;
    const za7 = addDaysISO(dzis, 7);
    const pilne = zob.filter((z) => z.kwota > 0 && !odh[z.id] && z.terminRoboczy <= za7 && z.terminRoboczy >= addDaysISO(dzis, -45));
    const zalegle = pilne.some((z) => z.terminRoboczy < dzis);
    return {
      sprzedaz: poTerminie > 0 ? { n: poTerminie, tone: 'red' } : undefined,
      terminy: pilne.length > 0 ? { n: pilne.length, tone: zalegle ? 'red' : 'amber' } : undefined,
    };
  }, [sales, zob, odh]);
}

export default function App(): JSX.Element {
  const backend = useBackend();
  const theme = useTheme();
  const route = useRoute();
  const { settings } = useStore();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(() => !onboardingZakonczony());
  const liczniki = useLiczniki();

  useEffect(() => {
    void initStore().finally(() => setReady(true));
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [route.page]);

  if (!ready) {
    return (
      <div className="app">
        <main>
          <div className="card muted">Łączenie z API…</div>
        </main>
      </div>
    );
  }

  const aktywna = NAV.find((n) => n.id === route.page) ?? NAV[0];
  let section = '';
  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <Icon name="menu" size={20} />
        </button>
        <div className="title">{aktywna.label}</div>
        <button className="btn small" onClick={() => navigate('sprzedaz', 'lista', 'nowa')}>
          <Icon name="plus" size={16} /> Faktura
        </button>
      </header>
      <div className={`scrim${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Nawigacja">
        <div className="brand">
          <div className="brand-logo">F</div>
          <div>
            <h1>Frank<span className="tag">JDG</span></h1>
            <div className="brand-sub">Księgowość jednoosobowa</div>
          </div>
        </div>
        <div className="sidebar-cta">
          <button className="btn" onClick={() => navigate('sprzedaz', 'lista', 'nowa')}>
            <Icon name="plus" size={16} /> Nowa faktura
          </button>
        </div>
        {NAV.map((t) => {
          const header = t.section && t.section !== section ? <div className="nav-label">{t.section}</div> : null;
          section = t.section;
          const l = liczniki[t.id];
          return (
            <div key={t.id}>
              {header}
              <a
                href={`#/${t.id}`}
                className={`nav-btn${route.page === t.id ? ' active' : ''}`}
                aria-current={route.page === t.id ? 'page' : undefined}
              >
                <Icon name={t.icon} size={18} />
                {t.label}
                {l && <span className={`count ${l.tone}`}>{l.n}</span>}
              </a>
            </div>
          );
        })}
        <div className="sidebar-foot">
          <a className="sidebar-firm" href="#/ustawienia/firma" style={{ textDecoration: 'none', color: 'inherit' }}>
            <b>{settings.firmaNazwa || 'Uzupełnij dane firmy'}</b>
            <small>{settings.firmaNip ? `NIP ${settings.firmaNip}` : 'Ustawienia → Firma'}</small>
          </a>
          <div className="sidebar-row">
            <div className={`conn${backend === 'online' ? ' online' : ' local'}`} title={backend === 'online' ? 'Dane zapisywane w SQLite przez API .NET' : 'API niedostępne — dane tylko w przeglądarce'}>
              <i />
              {backend === 'online' ? 'Zsynchronizowano' : 'Tryb lokalny'}
            </div>
            <button className="icon-btn" onClick={toggleTheme} title={theme === 'light' ? 'Tryb ciemny' : 'Tryb jasny'} aria-label="Przełącz motyw">
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
            </button>
          </div>
        </div>
      </nav>
      <main>
        {onboarding && (
          <Onboarding onClose={() => setOnboarding(false)} onGotoSales={() => navigate('sprzedaz', 'lista', 'nowa')} />
        )}
        {route.page === 'pulpit' && <DashboardTab />}
        {route.page === 'sprzedaz' && <SalesTab />}
        {route.page === 'koszty' && <CostsTab />}
        {route.page === 'kontrahenci' && <ContractorsTab />}
        {route.page === 'podatki' && <TaxesTab />}
        {route.page === 'terminy' && <TerminyPage />}
        {route.page === 'integracje' && <IntegracjeTab />}
        {route.page === 'ustawienia' && <SettingsTab />}
        {route.page === 'narzedzia' && (
          <>
            <div className="page-head">
              <div>
                <h2>Symulatory</h2>
                <p>Porównanie etatu z B2B i faktury cykliczne.</p>
              </div>
            </div>
            <div className="sections">
              <EtatVsB2b />
              <Cykliczne />
            </div>
          </>
        )}
      </main>
      <Toaster />
    </div>
  );
}
