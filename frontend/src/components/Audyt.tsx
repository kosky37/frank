import { useMemo, type JSX } from 'react';
import type { SalesInvoice, TaxpayerSettings } from '../../src-shared/tax/types.js';
import { audytPrzedWysylka } from '../lib/batchE.js';
import { Badge } from './ui.js';

/** Checklista „audyt przed wysyłką" — blokery i ostrzeżenia dla miesiąca. */
export function Audyt({ miesiac, sales, settings }: {
  miesiac: string;
  sales: SalesInvoice[];
  settings: TaxpayerSettings;
}): JSX.Element {
  const items = useMemo(() => audytPrzedWysylka({ sales, settings, miesiac }), [sales, settings, miesiac]);
  const bledy = items.filter((i) => i.status === 'blad').length;
  const ostrzezenia = items.filter((i) => i.status === 'warn').length;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Audyt przed wysyłką ({miesiac})</h3>
        {bledy === 0 && ostrzezenia === 0 ? (
          <Badge tone="green">czysto</Badge>
        ) : bledy > 0 ? (
          <Badge tone="red">{bledy} blokery</Badge>
        ) : (
          <Badge tone="amber">{ostrzezenia} ostrzeżenia</Badge>
        )}
      </div>
      <div className="unpaid audit-list">
        {items.map((i) => (
          <div key={i.id} className="unpaid-row">
            <div className="who">
              <b>{i.tytul}</b>
              <small>{i.opis}</small>
            </div>
            {i.status === 'ok' ? (
              <Badge tone="green">OK</Badge>
            ) : i.status === 'warn' ? (
              <Badge tone="amber">uwaga</Badge>
            ) : (
              <Badge tone="red">popraw</Badge>
            )}
          </div>
        ))}
      </div>
      {bledy > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          Usuń blokery (czerwone) zanim wyślesz JPK / KSeF / DRA — urząd ich nie wybaczy.
        </p>
      )}
    </div>
  );
}
