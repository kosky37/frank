import { useState, type JSX } from 'react';
import { addCost, uid, useStore } from '../lib/store.js';
import { api, ApiError, type KsefMeta } from '../lib/api.js';
import { fmtMoney } from '../lib/format.js';
import { Badge } from './ui.js';

function bladApi(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : 'Nieznany błąd';
}

/** Odbiór faktur zakupowych z KSeF 2.0 + import jako koszty. */
export function KsefOdbior(): JSX.Element {
  const { costs, settings } = useStore();
  const [faktury, setFaktury] = useState<KsefMeta[] | null>(null);
  const [info, setInfo] = useState('');
  const [ladowanie, setLadowanie] = useState(false);

  async function pobierz(): Promise<void> {
    setLadowanie(true);
    setInfo('');
    try {
      const r = await api.ksef.odbior();
      const lista = r.wynik.invoices ?? [];
      setFaktury(lista);
      const dopisek = r.wynik.hasMore ? ' (to pierwsze 50 — zawęź zakres w razie potrzeby)' : '';
      setInfo(
        `Pobrano ${lista.length} faktur z KSeF (${r.srodowisko})${dopisek}. ` +
        `UPO i treść każdej faktury weryfikuj w Aplikacji Podatnika.`,
      );
    } catch (e) {
      setInfo(
        `Błąd odbioru: ${bladApi(e)}. Sprawdź token KSeF i środowisko (test/demo/prod) w Ustawieniach → Integracje.`,
      );
    } finally {
      setLadowanie(false);
    }
  }

  function importuj(f: KsefMeta): void {
    if (costs.some((c) => c.numer === f.invoiceNumber)) {
      setInfo(`Faktura ${f.invoiceNumber} jest już zaksięgowana — pominięto duplikat.`);
      return;
    }
    const vat = Number(f.vatAmount ?? Number(f.grossAmount ?? 0) - Number(f.netAmount ?? 0));
    addCost({
      id: uid('cost'),
      numer: f.invoiceNumber,
      wystawca: f.seller?.name ?? `NIP ${f.seller?.nip ?? '?'}`,
      nipWystawcy: f.seller?.nip ?? '',
      dataZakupu: (f.issueDate ?? '').slice(0, 10),
      dataKsiegowania: (f.issueDate ?? '').slice(0, 10),
      kategoria: 'uslugi',
      pojazdowy: false,
      uzytkowaniePojazdu: 'mieszany',
      netto: Number(f.netAmount ?? 0),
      stawkaVat: 0.23,
      vatNaliczonyDowolny: Math.round(vat * 100) / 100,
      opis: `Import z KSeF (${f.ksefNumber})`,
      ksefId: f.ksefNumber,
    });
    setInfo(`Zaksięgowano ${f.invoiceNumber} jako koszt. Zweryfikuj stawkę VAT z treścią faktury w KSeF.`);
  }

  return (
    <div className="card span-all">
      <h3>Odbiór faktur z KSeF</h3>
      <p className="muted">
        Faktury zakupowe wystawione na Twój NIP trafiają do KSeF — pobierz je i zaksięguj jednym klikiem.
        {(settings.ksefSrodowisko ?? 'test') !== 'prod' && ' Środowisko testowe współdzielą integratorzy — nie używaj prawdziwych danych.'}
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
                const jest = costs.some((c) => c.numer === f.invoiceNumber);
                return (
                  <tr key={f.ksefNumber}>
                    <td><b>{f.invoiceNumber}</b><div className="muted">{f.ksefNumber}</div></td>
                    <td>{f.seller?.name ?? '—'}<div className="muted">NIP {f.seller?.nip ?? '?'}</div></td>
                    <td>{(f.issueDate ?? '').slice(0, 10)}</td>
                    <td className="num">{fmtMoney(Number(f.grossAmount ?? 0))}</td>
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
