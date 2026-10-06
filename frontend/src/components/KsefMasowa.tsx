import { useState, type JSX } from 'react';
import type { SalesInvoice } from '../../src-shared/tax/types.js';
import { api, ApiError } from '../lib/api.js';
import { updateSale } from '../lib/store.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/xml;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bladApi(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : 'Nieznany błąd';
}

/** Masowa wysyłka miesiąca do KSeF 2.0 jednym klikiem (prawdziwe FA(3) przez backend). */
export function KsefMasowa({ miesiac, faktury }: { miesiac: string; faktury: SalesInvoice[] }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[] | null>(null);

  const doWyslania = faktury.filter((f) => f.status === 'wystawiona');

  async function wyslij(): Promise<void> {
    setBusy(true);
    const lines: string[] = [];
    for (const f of doWyslania) {
      const tryb = f.trybKsef ?? 'online';
      try {
        const w = await api.ksef.wyslij(f.id);
        updateSale({ ...f, status: 'w_ksef', ksefId: w.ksefNumber ?? w.fakturaRef ?? f.ksefId });
        lines.push(
          `${f.numer}: wysłano${w.ksefNumber ? ` (nr KSeF ${w.ksefNumber})` : ''}${tryb !== 'online' ? ` [${tryb}]` : ''}${w.info ? ` — ${w.info}` : ''}`,
        );
      } catch (e) {
        lines.push(`${f.numer}: BŁĄD — ${bladApi(e)} (faktura zostaje jako wystawiona)`);
      }
    }
    setLog(lines);
    setBusy(false);
  }

  async function podglad(f: SalesInvoice): Promise<void> {
    try {
      const p = await api.ksef.podglad(f.id);
      download(`FA3-${f.numer.replaceAll('/', '-')}.xml`, p.xml);
      const w = p.walidacja;
      setLog([
        w.ok
          ? `${f.numer}: pobrano FA(3) XML zgodny z XSD MF.`
          : w.pominieta
            ? `${f.numer}: pobrano FA(3); walidacja XSD pominięta (${w.bledy.slice(0, 2).join('; ')}).`
            : `${f.numer}: FA(3) NIEZGODNY z XSD — ${w.bledy.slice(0, 3).join('; ')}`,
      ]);
    } catch (e) {
      setLog([`${f.numer}: BŁĄD podglądu — ${bladApi(e)}`]);
    }
  }

  return (
    <div className="card">
      <h3>Wysyłka KSeF ({miesiac})</h3>
      <p className="muted">
        Prawdziwa wysyłka FA(3) do KSeF 2.0 przez backend (token z Ustawień → Integracje).
        Bez tokenu backend zwróci błąd — faktura nie zmieni statusu.
      </p>
      {doWyslania.length === 0 ? (
        <p className="muted">Brak wystawionych faktur do wysyłki w tym miesiącu.</p>
      ) : (
        <>
          <p className="muted">{doWyslania.length} faktur czeka: {doWyslania.map((f) => f.numer).join(', ')}</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => void wyslij()}>
              {busy ? 'Wysyłanie…' : `Wyślij ${doWyslania.length} faktur do KSeF`}
            </button>
            {doWyslania.length === 1 && (
              <button className="btn secondary" disabled={busy} onClick={() => void podglad(doWyslania[0])}>
                Podgląd FA(3) XML
              </button>
            )}
          </div>
        </>
      )}
      {log && (
        <div className="muted" style={{ marginTop: 8 }}>
          {log.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
