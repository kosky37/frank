// Transakcje UE: podsumowanie WDT/WNT/eksportu (stawki oo/np) + check VIES + nota OSS.
import { useMemo, useState, type JSX } from 'react';
import type { SalesInvoice } from '../../src-shared/tax/types.js';
import { api, type ViesWynik } from '../lib/api.js';
import { fmtMoney } from '../lib/format.js';

export function UeVies({ sales }: { sales: SalesInvoice[] }): JSX.Element {
  const [kraj, setKraj] = useState('DE');
  const [nip, setNip] = useState('');
  const [wynik, setWynik] = useState<ViesWynik | null>(null);
  const [blad, setBlad] = useState('');
  const [laduje, setLaduje] = useState(false);

  const ue = useMemo(() => {
    let oo = 0;
    let np = 0;
    for (const s of sales) {
      if (s.status === 'robocza' || s.rodzaj === 'proforma') continue;
      for (const p of s.pozycje) {
        const netto = Math.round(p.ilosc * p.cenaNetto * 100) / 100;
        if (p.stawkaVat === 'oo') oo += netto;
        else if (p.stawkaVat === 'np') np += netto;
      }
    }
    return { oo: Math.round(oo * 100) / 100, np: Math.round(np * 100) / 100 };
  }, [sales]);

  function sprawdz(): void {
    setLaduje(true);
    setBlad('');
    setWynik(null);
    api.viesLookup(kraj, nip)
      .then((w) => setWynik(w))
      .catch((e: unknown) => setBlad(e instanceof Error ? e.message : 'Brak odpowiedzi VIES'))
      .finally(() => setLaduje(false));
  }

  return (
    <div className="card">
      <h3>Transakcje UE (WDT/WNT/eksport 0%)</h3>
      <div className="muted">
        YTD: <b>oo</b> {fmtMoney(ue.oo)} (WDT/eksport — sprawdź kontrahenta w VIES + VAT-UE) •{' '}
        <b>np</b> {fmtMoney(ue.np)} (nie podlega / odwrotne obciążenie krajowe)
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label className="muted" htmlFor="vies-kraj">Kraj UE</label>
          <input id="vies-kraj" value={kraj} onChange={(e) => setKraj(e.target.value.toUpperCase())} maxLength={2} style={{ maxWidth: 70 }} placeholder="DE" />
        </div>
        <div>
          <label className="muted" htmlFor="vies-nip">VAT UE kontrahenta</label>
          <input id="vies-nip" value={nip} onChange={(e) => setNip(e.target.value)} placeholder="123456789" style={{ maxWidth: 200 }} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn secondary small" disabled={laduje || !nip.trim()} onClick={sprawdz}>
            {laduje ? 'Sprawdzam…' : 'Sprawdź VIES'}
          </button>
        </div>
      </div>
      {wynik && (
        <div className={wynik.aktywny ? 'info' : 'warn'} style={{ marginTop: 8 }}>
          {wynik.kraj} {wynik.nip}: {wynik.aktywny ? 'aktywny podatnik VAT UE' : 'NIEAKTYWNY w VIES — nie stosuj 0% WDT'}
          {wynik.nazwa ? ` • ${wynik.nazwa}` : ''}{wynik.adres ? ` • ${wynik.adres}` : ''}
        </div>
      )}
      {blad && <div className="field-error" style={{ marginTop: 6 }}>{blad}</div>}
      <p className="muted" style={{ marginTop: 8 }}>
        WDT 0% wymaga aktywnego VIES + VAT-UE (złóż przed pierwszą transakcją) + dowodu wywozu.
        Sprzedaż usług B2C do UE rozlicz w OSS (kwartalnie) zamiast polskiego VAT.
      </p>
    </div>
  );
}
