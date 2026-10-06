// Cykliczne faktury: szablon (ostatnia wystawiona) + dzień miesiąca → generuj zaległe.
import { useState, type JSX } from 'react';
import { addSale, uid, useStore } from '../lib/store.js';
import { addDaysISO, fmtMoney, monthLabel, todayISO } from '../lib/format.js';
import { nastepnyNumer } from './Sales.js';
import { nalezneCykle, type CyklFaktury } from '../lib/quickwins.js';
import { salesVat } from '../../src-shared/tax/vat.js';

const KEY = 'frank-cykle';

function wczytaj(): CyklFaktury[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CyklFaktury[];
  } catch { /* ignore */ }
  return [];
}

function zapisz(c: CyklFaktury[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

export function Cykliczne(): JSX.Element {
  const { sales } = useStore();
  const [cykle, setCykle] = useState<CyklFaktury[]>(wczytaj);
  const [dzien, setDzien] = useState(5);
  const biezacy = todayISO().slice(0, 7);

  const ostatnia = [...sales]
    .filter((s) => s.status !== 'robocza' && (s.rodzaj ?? 'sprzedazy') === 'sprzedazy')
    .sort((a, b) => b.dataSprzedazy.localeCompare(a.dataSprzedazy))[0];
  const due = nalezneCykle(cykle, biezacy);

  function odswiez(next: CyklFaktury[]): void {
    setCykle(next);
    zapisz(next);
  }

  function dodajCykl(): void {
    if (!ostatnia) return;
    odswiez([...cykle, {
      id: uid('cykl'),
      szablonNumer: ostatnia.numer,
      dzienMiesiaca: Math.max(1, Math.min(28, dzien || 5)),
      aktywna: true,
    }]);
  }

  function generuj(): void {
    let robocze = [...sales];
    const next = cykle.map((c) => ({ ...c }));
    for (const { cykl, miesiac } of due) {
      const szablon = sales.find((s) => s.numer === cykl.szablonNumer) ?? ostatnia;
      if (!szablon) continue;
      const dzienEff = String(Math.min(cykl.dzienMiesiaca, 28)).padStart(2, '0');
      const data = `${miesiac}-${dzienEff}`;
      const inv = {
        ...structuredClone(szablon),
        id: uid('fv'),
        numer: nastepnyNumer(robocze, data),
        dataWystawienia: data,
        dataSprzedazy: data,
        terminPlatnosci: addDaysISO(data, 14),
        status: 'robocza' as const,
        ksefId: undefined,
        zaplacona: false,
      };
      robocze = [...robocze, inv];
      addSale(inv);
      const c = next.find((x) => x.id === cykl.id);
      if (c && (c.ostatniWygenerowany ?? '') < miesiac) c.ostatniWygenerowany = miesiac;
    }
    odswiez(next);
  }

  return (
    <div className="card">
      <h3>Cykliczne faktury</h3>
      {cykle.length === 0 ? (
        <p className="muted">Brak cykli. Szablon: ostatnia sprzedaż{ostatnia ? ` (${ostatnia.numer}, ${fmtMoney(salesVat(ostatnia).brutto)})` : ' — wystaw najpierw fakturę'}.</p>
      ) : (
        <div className="unpaid">
          {cykle.map((c) => (
            <div key={c.id} className="unpaid-row">
              <div className="who">
                <b>{c.szablonNumer}</b>
                <small>dzień {c.dzienMiesiaca} • ostatni: {c.ostatniWygenerowany ?? '—'} • {c.aktywna ? 'aktywny' : 'wstrzymany'}</small>
              </div>
              <button className="btn ghost small" onClick={() => odswiez(cykle.map((x) => (x.id === c.id ? { ...x, aktywna: !x.aktywna } : x)))}>
                {c.aktywna ? 'Wstrzymaj' : 'Wznów'}
              </button>
              <button className="btn ghost small" onClick={() => odswiez(cykle.filter((x) => x.id !== c.id))}>Usuń</button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label className="muted" htmlFor="cykl-dzien">Dzień miesiąca</label>
          <input id="cykl-dzien" type="number" min={1} max={28} value={dzien} onChange={(e) => setDzien(Number(e.target.value))} style={{ maxWidth: 90 }} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn secondary small" disabled={!ostatnia} onClick={dodajCykl} title="Cykl z ostatniej faktury sprzedaży">
            + Cykl z ostatniej faktury
          </button>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn small" disabled={due.length === 0} onClick={generuj}>
            Generuj zaległe ({due.length}: {due.map((d) => monthLabel(d.miesiac)).join(', ') || 'brak'})
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Generuje robocze kopie szablonu z nowym numerem i datami. Wysyłka maila do klienta wymaga podpięcia skrzynki (stub — fakturę wyślij ręcznie z Podglądu/PDF).
      </p>
    </div>
  );
}
