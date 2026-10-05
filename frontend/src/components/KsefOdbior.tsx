import { useState, type JSX } from 'react';
import { addCost, uid, useStore } from '../lib/store.js';
import { fmtMoney } from '../lib/format.js';
import { Badge } from './ui.js';

interface KsefZakup {
  ksefId: string;
  numer: string;
  nipSprzedawcy: string;
  nazwaSprzedawcy: string;
  dataSprzedazy: string;
  netto: number;
  vat: number;
  brutto: number;
}

/** Odbiór faktur zakupowych z KSeF + import jako koszty. */
export function KsefOdbior(): JSX.Element {
  const { costs, settings } = useStore();
  const [faktury, setFaktury] = useState<KsefZakup[] | null>(null);
  const [info, setInfo] = useState('');
  const [ladowanie, setLadowanie] = useState(false);

  async function pobierz(): Promise<void> {
    setLadowanie(true);
    setInfo('');
    try {
      const res = await fetch('/api/mock/ksef/faktury');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFaktury((await res.json()) as KsefZakup[]);
      setInfo(
        settings.ksefSrodowisko === 'prod'
          ? 'Tryb prod: produkcyjny odbiór wymaga certyfikatu KSeF — poniżej dane DEMO do testu importu.'
          : 'Pobrano faktury (środowisko demo).',
      );
    } catch {
      setInfo('Brak API (tryb lokalny) — podłącz backend, by odebrać faktury.');
    } finally {
      setLadowanie(false);
    }
  }

  function importuj(f: KsefZakup): void {
    if (costs.some((c) => c.numer === f.numer)) {
      setInfo(`Faktura ${f.numer} jest już zaksięgowana — pominięto duplikat.`);
      return;
    }
    addCost({
      id: uid('cost'),
      numer: f.numer,
      wystawca: f.nazwaSprzedawcy,
      nipWystawcy: f.nipSprzedawcy,
      dataZakupu: f.dataSprzedazy,
      dataKsiegowania: f.dataSprzedazy,
      kategoria: 'uslugi',
      pojazdowy: false,
      uzytkowaniePojazdu: 'mieszany',
      netto: f.netto,
      stawkaVat: 0.23,
      vatNaliczonyDowolny: f.vat,
      opis: `Import z KSeF (${f.ksefId})`,
    });
    setInfo(`Zaksięgowano ${f.numer} jako koszt.`);
  }

  return (
    <div className="card span-all">
      <h3>Odbiór faktur z KSeF</h3>
      <p className="muted">
        Faktury zakupowe wystawione na Twój NIP trafiają do KSeF — pobierz je i zaksięguj jednym klikiem.
      </p>
      <div className="row">
        <button className="btn" disabled={ladowanie} onClick={() => void pobierz()}>
          {ladowanie ? 'Pobieranie…' : 'Pobierz faktury z KSeF'}
        </button>
      </div>
      {faktury && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>Numer</th><th>Wystawca</th><th>Data</th><th className="num">Brutto</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {faktury.length === 0 && (
                <tr><td colSpan={6} className="muted">Brak nowych faktur w KSeF.</td></tr>
              )}
              {faktury.map((f) => {
                const jest = costs.some((c) => c.numer === f.numer);
                return (
                  <tr key={f.ksefId}>
                    <td><b>{f.numer}</b><div className="muted">{f.ksefId}</div></td>
                    <td>{f.nazwaSprzedawcy}<div className="muted">NIP {f.nipSprzedawcy}</div></td>
                    <td>{f.dataSprzedazy}</td>
                    <td className="num">{fmtMoney(f.brutto)}</td>
                    <td>{jest ? <Badge tone="green">zaksięgowana</Badge> : <Badge tone="amber">nowa</Badge>}</td>
                    <td className="actions">
                      {!jest && (
                        <button className="btn ghost small" onClick={() => importuj(f)}>
                          Zaksięguj koszt
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {info && <p className="muted" style={{ marginTop: 8 }}>{info}</p>}
    </div>
  );
}
