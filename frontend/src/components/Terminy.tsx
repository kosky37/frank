import { useMemo, useState, type JSX } from 'react';
import { buildIcs, type TerminIcs } from '../lib/batchE.js';
import { terminyCsv } from '../lib/quickwins.js';
import { formatDataPL } from '../lib/format.js';

export interface Termin extends TerminIcs {
  rodzaj: 'pit' | 'zus' | 'vat' | 'roczny' | 'info';
}

const KEY = 'frank-terminy';

function wczytajOdhaczone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Przesunięcie terminu z weekendu na poniedziałek (ZUS/US przyjmują następny roboczy). */
export function dzienRoboczy(rok: number, miesiac: number, dzien: number): string {
  const d = new Date(rok, miesiac - 1, Math.min(dzien, 28));
  // ustaw ostatni możliwy dzień jeśli miesiąc krótszy
  d.setDate(Math.min(dzien, new Date(rok, miesiac, 0).getDate()));
  const w = d.getDay();
  if (w === 6) d.setDate(d.getDate() + 2);
  else if (w === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MIESIACE = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

function terminyRoku(rok: number): Termin[] {
  const out: Termin[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const poprz = m === 1 ? `XII/${rok - 1}` : MIESIACE[m - 2];
    out.push({
      id: `${rok}-${mm}-pit`, data: dzienRoboczy(rok, m, 20),
      tytul: `PIT zaliczka za ${poprz} — do 20.`,
      opis: 'Zaliczka miesięczna/kwartalna na mikrorachunek (bez deklaracji).', rodzaj: 'pit',
    });
    out.push({
      id: `${rok}-${mm}-zus`, data: dzienRoboczy(rok, m, 20),
      tytul: `ZUS DRA za ${poprz} — do 20.`,
      opis: 'Składki jednym przelewem na NRS + deklaracja DRA.', rodzaj: 'zus',
    });
    out.push({
      id: `${rok}-${mm}-vat`, data: dzienRoboczy(rok, m, 25),
      tytul: `VAT za ${poprz} — do 25.`,
      opis: 'JPK_V7M / JPK_V7K + zapłata VAT (osobny obowiązek).', rodzaj: 'vat',
    });
  }
  if (rok === 2026) {
    out.push(
      { id: '2026-ksef-odbior', data: '2026-02-01', tytul: 'KSeF: obowiązek odbioru', opis: 'Od 1.02.2026 obowiązkowy odbiór faktur w KSeF.', rodzaj: 'info' },
      { id: '2026-epit-start', data: '2026-02-15', tytul: 'PIT roczny: start', opis: 'Od 15 lutego Twój e-PIT (PIT-36/36L/28 wysyłasz aktywnie).', rodzaj: 'roczny' },
      { id: '2026-ksef-wyst', data: '2026-04-01', tytul: 'KSeF: obowiązek wystawiania', opis: 'Od 1.04.2026 obowiązkowe wystawianie w KSeF.', rodzaj: 'info' },
      { id: '2026-pit-koniec', data: '2026-04-30', tytul: 'PIT roczny: koniec', opis: 'PIT-36 / 36L / 28 + zapłata podatku — do 30 kwietnia.', rodzaj: 'roczny' },
      { id: '2026-dra-roczna', data: '2026-05-20', tytul: 'DRA roczna (zdrowotna)', opis: 'Roczne rozliczenie składki zdrowotnej — do 20 maja.', rodzaj: 'zus' },
      { id: '2026-zwrot', data: '2026-06-01', tytul: 'Zwrot nadpłaty zdrowotnej', opis: 'Wniosek o zwrot nadpłaty — do 1 czerwca.', rodzaj: 'zus' },
      { id: '2026-edorec', data: '2026-10-01', tytul: 'e-Doręczenia', opis: 'Obowiązkowy adres do e-Doręczeń (CEIDG).', rodzaj: 'info' },
      { id: '2026-pkd', data: '2026-12-31', tytul: 'CEIDG: PKD 2025', opis: 'Aktualizacja kodów PKD — do 31.12.2026.', rodzaj: 'info' },
    );
  } else {
    out.push(
      { id: `${rok}-pit-start`, data: `${rok}-02-15`, tytul: 'PIT roczny: start', opis: 'Od 15 lutego Twój e-PIT.', rodzaj: 'roczny' },
      { id: `${rok}-pit-koniec`, data: `${rok}-04-30`, tytul: 'PIT roczny: koniec', opis: 'PIT-36 / 36L / 28 + zapłata podatku — do 30 kwietnia.', rodzaj: 'roczny' },
      { id: `${rok}-dra-roczna`, data: `${rok}-05-20`, tytul: 'DRA roczna (zdrowotna)', opis: 'Roczne rozliczenie składki zdrowotnej — do 20 maja.', rodzaj: 'zus' },
    );
  }
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.tytul.localeCompare(b.tytul));
}

function dzisISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Terminy(): JSX.Element {
  const [rok, setRok] = useState(2026);
  const [odhaczone, setOdhaczone] = useState<Record<string, boolean>>(wczytajOdhaczone);
  const dzis = dzisISO();
  const wszystkie = useMemo(() => terminyRoku(rok), [rok]);
  const nadchodzace = wszystkie.filter((t) => t.data >= dzis && !odhaczone[t.id]).slice(0, 3);

  const miesiaceKal = useMemo(() => {
    const m: { nazwa: string; terminy: Termin[] }[] = MIESIACE.map((nazwa) => ({ nazwa, terminy: [] }));
    for (const t of wszystkie) {
      const mi = Number(t.data.slice(5, 7));
      if (t.data.startsWith(String(rok)) && mi >= 1 && mi <= 12) m[mi - 1].terminy.push(t);
    }
    return m;
  }, [wszystkie, rok]);

  function przelacz(id: string): void {
    const next = { ...odhaczone, [id]: !odhaczone[id] };
    setOdhaczone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function eksportIcal(): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildIcs(wszystkie, rok)], { type: 'text/calendar;charset=utf-8' }));
    a.download = `frank-terminy-${rok}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function eksportCsv(): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([terminyCsv(wszystkie)], { type: 'text/csv;charset=utf-8' }));
    a.download = `frank-terminy-${rok}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Najbliższe 3 terminy</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn ghost small" onClick={eksportIcal} title="Eksport terminów do kalendarza (Google/Apple/Outlook)">
              Eksport iCal
            </button>
            <button className="btn ghost small" onClick={eksportCsv} title="Eksport terminów do arkusza (id;data;tytuł;opis)">
              Eksport CSV
            </button>
            <label className="muted" htmlFor="terminy-rok" style={{ fontSize: 12 }}>Rok</label>
            <select id="terminy-rok" aria-label="Rok terminów" className="compact" value={rok} onChange={(e) => setRok(Number(e.target.value))}>
              {[2025, 2026, 2027].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        {nadchodzace.length === 0 ? (
          <p className="muted">Wszystko odhaczone lub brak nadchodzących terminów {rok}.</p>
        ) : (
          <div className="unpaid">
            {nadchodzace.map((t) => (
              <div key={t.id} className="unpaid-row">
                <div className="who">
                  <b>{t.tytul}</b>
                  <small>{t.opis}</small>
                </div>
                <span className="amt">{formatDataPL(t.data)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Kalendarz {rok} — kliknij, by odhaczyć opłacone/wysłane</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {miesiaceKal.map((m) => (
            <div key={m.nazwa} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
              <b>{m.nazwa}</b>
              {m.terminy.length === 0 && <div className="muted">—</div>}
              {m.terminy.map((t) => (
                <label key={t.id} className="inline" style={{ fontWeight: 400, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={!!odhaczone[t.id]} onChange={() => przelacz(t.id)} aria-label={`${t.tytul} ${formatDataPL(t.data)}`} />
                  <span style={{ textDecoration: odhaczone[t.id] ? 'line-through' : undefined }}>
                    {formatDataPL(t.data)}: {t.tytul.split(' — ')[0]}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Daty z weekendu przesunięte na poniedziałek. PIT — do 20., ZUS DRA — do 20.,
          VAT — do 25. następnego miesiąca (kwartalne: po kwartale). PIT roczny: 15 lutego – 30 kwietnia.
        </p>
      </div>
    </>
  );
}
