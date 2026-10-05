import { useEffect, useState, type JSX } from 'react';
import { initStore, useBackend } from './lib/store.js';
import { toggleTheme, useTheme } from './lib/theme.js';
import { DashboardTab } from './components/Dashboard.js';
import { SalesTab } from './components/Sales.js';
import { CostsTab } from './components/Costs.js';
import { ContractorsTab } from './components/Contractors.js';
import { TaxesTab } from './components/Taxes.js';
import { SettingsTab } from './components/Settings.js';
import { IntegracjeTab } from './components/Integracje.js';
import { Terminy } from './components/Terminy.js';
import './styles.css';

type Tab = 'pulpit' | 'sprzedaz' | 'koszty' | 'kontrahenci' | 'podatki' | 'integracje' | 'ustawienia';

const TABS: { id: Tab; label: string; section: string }[] = [
  { id: 'pulpit', label: 'Pulpit', section: 'Przegląd' },
  { id: 'sprzedaz', label: 'Faktury sprzedaży', section: 'Dokumenty' },
  { id: 'koszty', label: 'Koszty', section: 'Dokumenty' },
  { id: 'kontrahenci', label: 'Kontrahenci', section: 'Dokumenty' },
  { id: 'podatki', label: 'Podatki i deklaracje', section: 'Rozliczenia' },
  { id: 'integracje', label: 'Integracje i wysyłka', section: 'Rozliczenia' },
  { id: 'ustawienia', label: 'Ustawienia', section: 'Rozliczenia' },
];

export default function App(): JSX.Element {
  const backend = useBackend();
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('pulpit');

  useEffect(() => {
    void initStore().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="app">
        <main>
          <div className="card">Łączenie z API…</div>
        </main>
      </div>
    );
  }

  let section = '';
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <h1>Frank</h1>
          <span>JDG</span>
        </div>
        <div className="brand-sub">Księgowość programisty • 2026</div>
        {TABS.map((t) => {
          const header = t.section !== section ? (
            <div className="nav-label" key={`label-${t.section}`}>
              {t.section}
            </div>
          ) : null;
          section = t.section;
          return (
            <div key={t.id}>
              {header}
              <button className={`nav-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="dot" />
                {t.label}
              </button>
            </div>
          );
        })}
        <div className="sidebar-foot">
          <button className="btn secondary small" onClick={toggleTheme} title="Przełącz motyw">
            {theme === 'light' ? '☾ Tryb ciemny' : '☀ Tryb jasny'}
          </button>
          <div className={`conn${backend === 'online' ? ' online' : ' local'}`}>
            <i />
            {backend === 'online' ? 'API: .NET + SQLite' : 'tryb lokalny (bez API)'}
          </div>
        </div>
      </nav>
      <main>
        {tab === 'pulpit' && <DashboardTab onGotoSales={() => setTab('sprzedaz')} />}
        {tab === 'sprzedaz' && <SalesTab />}
        {tab === 'koszty' && <CostsTab />}
        {tab === 'kontrahenci' && <ContractorsTab />}
        {tab === 'podatki' && <TaxesTab />}
        {tab === 'integracje' && <IntegracjeTab />}
        {tab === 'ustawienia' && <SettingsTab />}
      </main>
    </div>
  );
}
