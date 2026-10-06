import { useRef, useState, type JSX } from 'react';
import { buildBackup, parseBackup } from '../lib/batchE.js';
import { kosztyCsv, sprzedazCsv } from '../lib/quickwins.js';
import { getStore, replaceStore } from '../lib/store.js';
import type { ContractorFull } from '../lib/api.js';

function download(name: string, text: string, mime = 'application/json;charset=utf-8'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Backup 1-klik: eksport JSON + import z walidacją. */
export function Backup(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [komunikat, setKomunikat] = useState<string | null>(null);

  function eksport(): void {
    const s = getStore();
    download(
      `frank-backup-${new Date().toISOString().slice(0, 10)}.json`,
      buildBackup({ sales: s.sales, costs: s.costs, settings: s.settings, contractors: s.contractors }),
    );
    setKomunikat('Backup pobrany. Trzymaj go 5 lat (dokumenty) — pliki KSeF archiwizuj 10 lat.');
  }

  function importujplik(file: File): void {
    void file.text().then((text) => {
      try {
        const data = parseBackup(text);
        replaceStore({ sales: data.sales, costs: data.costs, settings: data.settings, contractors: data.contractors as ContractorFull[] });
        setKomunikat(`Przywrócono: ${data.sales.length} faktur, ${data.costs.length} kosztów.`);
      } catch (e) {
        setKomunikat(`Błąd importu: ${e instanceof Error ? e.message : 'nieznany błąd'}`);
      }
    });
  }

  return (
    <div className="card">
      <h3>Backup 1-klik</h3>
      <p className="muted">Pełny stan (faktury, koszty, ustawienia, kontrahenci) jako JSON na Twój dysk.</p>
      <div className="btn-grid">
        <button className="btn" onClick={eksport}>
          Pobierz backup
        </button>
        <button className="btn secondary" onClick={() => inputRef.current?.click()}>
          Przywróć z pliku…
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importujplik(f);
          e.target.value = '';
        }}
      />
      <div className="btn-grid" style={{ marginTop: 8 }}>
        <button
          className="btn secondary small"
          title="Faktury do arkusza (numer;kontrahent;nip;data;netto;status;rodzaj)"
          onClick={() => download(`frank-faktury-${new Date().toISOString().slice(0, 10)}.csv`, sprzedazCsv(getStore().sales), 'text/csv;charset=utf-8')}
        >
          Eksport faktur CSV
        </button>
        <button
          className="btn secondary small"
          title="Koszty w formacie importu (numer;wystawca;data;netto;vat;kategoria)"
          onClick={() => download(`frank-koszty-${new Date().toISOString().slice(0, 10)}.csv`, kosztyCsv(getStore().costs), 'text/csv;charset=utf-8')}
        >
          Eksport kosztów CSV
        </button>
      </div>
      {komunikat && <p className="muted" style={{ marginTop: 8 }}>{komunikat}</p>}
      <p className="muted">
        Przywrócenie nadpisuje dane lokalne.
      </p>
    </div>
  );
}
