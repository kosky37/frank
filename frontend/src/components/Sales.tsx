import { Fragment, useMemo, useState, type JSX } from 'react';
import type { InvoiceItem, InvoiceStatus, SalesInvoice, VatRate } from '../../src-shared/tax/types.js';
import { salesVat } from '../../src-shared/tax/vat.js';
import { buildKsefStub } from '../../src-shared/tax/integrations.js';
import { addDaysISO, fmtMoney, isValidNip, monthLabel, todayISO, vatLabel, VAT_OPTIONS } from '../lib/format.js';
import { RYCZALT } from '../../src-shared/dictionaries.js';
import { addSale, removeSale, updateSale, uid, useStore } from '../lib/store.js';
import type { ContractorFull } from '../lib/api.js';
import { Badge, ConfirmButton, Empty, Field, Modal, StatusBadge } from './ui.js';
import { RegistrySearch } from './Contractors.js';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Następny numer faktury w formacie N/MM/RRRR, kontynuujący serię miesięczną. */
export function nastepnyNumer(sales: SalesInvoice[], dataISO: string): string {
  const mm = dataISO.slice(5, 7);
  const rrrr = dataISO.slice(0, 4);
  let max = 0;
  for (const s of sales) {
    const m = /^(\d+)\/(\d{2})\/(\d{4})$/.exec(s.numer.trim());
    if (m && m[2] === mm && m[3] === rrrr) max = Math.max(max, Number(m[1]));
  }
  return `${max + 1}/${mm}/${rrrr}`;
}

const STATUS_FILTER: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Wszystkie statusy' },
  { value: 'robocza', label: 'Robocze' },
  { value: 'wystawiona', label: 'Wystawione' },
  { value: 'w_ksef', label: 'W KSeF' },
];

type ModalState = { mode: 'create' } | { mode: 'edit'; inv: SalesInvoice } | null;

export function SalesTab(): JSX.Element {
  const { sales } = useStore();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [miesiac, setMiesiac] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const miesiace = useMemo(() => {
    const s = new Set(sales.map((x) => x.dataSprzedazy.slice(0, 7)));
    return [...s].sort().reverse();
  }, [sales]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sales
      .filter((s) => (status === 'all' ? true : s.status === status))
      .filter((s) => (miesiac === 'all' ? true : s.dataSprzedazy.startsWith(miesiac)))
      .filter((s) =>
        needle
          ? [s.numer, s.kontrahent.nazwa, s.kontrahent.nip].some((v) =>
              v.toLowerCase().includes(needle),
            )
          : true,
      )
      .sort((a, b) => b.dataSprzedazy.localeCompare(a.dataSprzedazy));
  }, [sales, q, status, miesiac]);

  const sumaNetto = filtered.reduce((a, s) => a + salesVat(s).netto, 0);
  const sumaBrutto = filtered.reduce((a, s) => a + salesVat(s).brutto, 0);
  const nieoplacone = filtered.filter((s) => s.status !== 'robocza' && !s.zaplacona);
  const sumaNieoplacone = nieoplacone.reduce((a, s) => a + salesVat(s).brutto, 0);

  function duplicate(inv: SalesInvoice): void {
    const today = todayISO();
    addSale({
      ...structuredClone(inv),
      id: uid('fv'),
      numer: nastepnyNumer(sales, today),
      dataWystawienia: today,
      dataSprzedazy: today,
      terminPlatnosci: addDaysISO(today, 14),
      status: 'robocza',
      ksefId: undefined,
      zaplacona: false,
    });
  }

  function korekta(inv: SalesInvoice): void {
    const today = todayISO();
    const clone = structuredClone(inv);
    clone.pozycje = clone.pozycje.map((p) => ({
      ...p,
      nazwa: `Korekta do ${inv.numer} — ${p.nazwa}`,
    }));
    addSale({
      ...clone,
      id: uid('fv'),
      numer: nastepnyNumer(sales, today),
      dataWystawienia: today,
      dataSprzedazy: today,
      terminPlatnosci: addDaysISO(today, 14),
      status: 'robocza',
      ksefId: undefined,
      zaplacona: false,
    });
  }

  const ostatniaWystawiona = useMemo(
    () =>
      [...sales]
        .filter((s) => s.status !== 'robocza')
        .sort((a, b) => b.dataSprzedazy.localeCompare(a.dataSprzedazy))[0],
    [sales],
  );

  function kopiujPoprzedniMiesiac(): void {
    if (!ostatniaWystawiona) return;
    const today = todayISO();
    addSale({
      ...structuredClone(ostatniaWystawiona),
      id: uid('fv'),
      numer: nastepnyNumer(sales, today),
      dataWystawienia: today,
      dataSprzedazy: today,
      terminPlatnosci: addDaysISO(today, 14),
      status: 'robocza',
      ksefId: undefined,
      zaplacona: false,
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Faktury sprzedaży</h2>
          <p>
            {filtered.length} z {sales.length} • netto {fmtMoney(sumaNetto)} • brutto{' '}
            {fmtMoney(sumaBrutto)}
            {sumaNieoplacone > 0 && <> • niezapłacone <b>{fmtMoney(sumaNieoplacone)}</b></>}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn secondary"
            disabled={!ostatniaWystawiona}
            title={
              ostatniaWystawiona
                ? `Skopiuje fakturę ${ostatniaWystawiona.numer} (${ostatniaWystawiona.kontrahent.nazwa}) z nowymi datami i numerem`
                : 'Brak wystawionych faktur do skopiowania'
            }
            onClick={kopiujPoprzedniMiesiac}
          >
            Kopiuj poprzedni miesiąc
          </button>
          <button className="btn" onClick={() => setModal({ mode: 'create' })}>
            + Nowa faktura
          </button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, klient, NIP…" />
          </div>
          <select className="compact" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | 'all')}>
            {STATUS_FILTER.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
            <option value="all">Wszystkie miesiące</option>
            {miesiace.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
        {filtered.length === 0 ? (
          <Empty
            title={sales.length === 0 ? 'Brak faktur' : 'Brak wyników'}
            hint={sales.length === 0 ? 'Wystaw pierwszą fakturę przyciskiem powyżej.' : 'Zmień filtry lub wyczyść wyszukiwanie.'}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Numer</th><th>Klient</th><th>Sprzedaż</th><th>Termin</th>
                  <th className="num">Netto</th><th className="num">Brutto</th>
                  <th>Status</th><th>Zapłata</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const v = salesVat(s);
                  const overdue = s.status !== 'robocza' && !s.zaplacona && s.terminPlatnosci < todayISO();
                  const isOpen = expanded === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr className={isOpen ? 'expanded' : ''}>
                        <td><b>{s.numer}</b></td>
                        <td>{s.kontrahent.nazwa}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.dataSprzedazy}</td>
                        <td style={{ whiteSpace: 'nowrap' }} className={overdue ? 'overdue' : ''}>
                          {s.terminPlatnosci}
                        </td>
                        <td className="num">{fmtMoney(v.netto)}</td>
                        <td className="num"><b>{fmtMoney(v.brutto)}</b></td>
                        <td><StatusBadge status={s.status} /></td>
                        <td>
                          {s.status === 'robocza' ? (
                            <span className="muted">—</span>
                          ) : s.zaplacona ? (
                            <Badge tone="green">Opłacona</Badge>
                          ) : overdue ? (
                            <Badge tone="red">Po terminie</Badge>
                          ) : (
                            <Badge tone="amber">Oczekuje</Badge>
                          )}
                        </td>
                        <td className="actions">
                          <button className="btn ghost small" onClick={() => setExpanded(isOpen ? null : s.id)}>
                            {isOpen ? 'Zwiń' : 'Podgląd'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail">
                          <td colSpan={9}>
                            <InvoiceDetail
                              inv={s}
                              onEdit={() => setModal({ mode: 'edit', inv: s })}
                              onDuplicate={() => duplicate(s)}
                              onKorekta={() => korekta(s)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <InvoiceModal
          key={modal.mode === 'edit' ? modal.inv.id : 'new'}
          initial={modal.mode === 'edit' ? modal.inv : undefined}
          existing={sales}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function InvoiceDetail({
  inv,
  onEdit,
  onDuplicate,
  onKorekta,
}: {
  inv: SalesInvoice;
  onEdit: () => void;
  onDuplicate: () => void;
  onKorekta: () => void;
}): JSX.Element {
  const v = salesVat(inv);
  const duzaKwota = v.brutto > 15000;
  return (
    <div>
      <div className="detail-grid">
        <div>
          <h4>Kontrahent</h4>
          <div><b>{inv.kontrahent.nazwa}</b></div>
          <div className="muted">NIP {inv.kontrahent.nip || '—'}</div>
          <div className="muted">{inv.kontrahent.adres || ''} {inv.kontrahent.email ?? ''}</div>
        </div>
        <div>
          <h4>Daty</h4>
          <div className="muted">Wystawienia: {inv.dataWystawienia}</div>
          <div className="muted">Sprzedaży: {inv.dataSprzedazy}</div>
          <div className="muted">Termin: {inv.terminPlatnosci}</div>
          {inv.ksefId && <div className="muted">KSeF: {inv.ksefId}</div>}
        </div>
        <div>
          <h4>Pozycje</h4>
          {inv.pozycje.map((p, i) => (
            <div key={i} className="muted">
              {p.nazwa} — {p.ilosc} × {fmtMoney(p.cenaNetto)} ({vatLabel(p.stawkaVat)})
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            Netto {fmtMoney(v.netto)} • VAT {fmtMoney(v.vat)} • <b>Brutto {fmtMoney(v.brutto)}</b>
            {inv.waluta && inv.waluta !== 'PLN' && (
              <> • {inv.waluta}{inv.kursNbp ? ` (kurs NBP ${inv.kursNbp})` : ''}</>
            )}
          </div>
        </div>
        <div>
          <h4>Płatność</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {inv.mpp ? <Badge tone="amber">MPP</Badge> : <span className="muted">bez MPP</span>}
          </div>
          {inv.rachunekBankowy && <div className="muted">Rachunek: {inv.rachunekBankowy}</div>}
          <div className="muted">
            Biała Lista sprawdzona: {inv.bialaListaSprawdzona ?? 'nie sprawdzono'}
          </div>
          <button
            className="btn ghost small"
            style={{ marginTop: 6 }}
            onClick={() => updateSale({ ...inv, bialaListaSprawdzona: new Date().toISOString() })}
          >
            Oznacz sprawdzenie Białej Listy
          </button>
        </div>
      </div>
      {duzaKwota && (
        <div className="warn" style={{ marginTop: 8 }}>
          Brutto powyżej 15 000 zł — sprawdź Białą Listę w dniu zlecenia lub MPP/ZAW-NR 7d.
          {inv.bialaListaSprawdzona
            ? ` Ostatnie sprawdzenie: ${inv.bialaListaSprawdzona}.`
            : ' Brak potwierdzenia sprawdzenia.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {inv.status === 'robocza' && (
          <>
            <button className="btn small" onClick={() => updateSale({ ...inv, status: 'wystawiona' })}>
              Wystaw fakturę
            </button>
            <button className="btn secondary small" onClick={onEdit}>
              Edytuj
            </button>
          </>
        )}
        {inv.status === 'wystawiona' && (
          <button
            className="btn secondary small"
            onClick={() => {
              const id = inv.ksefId ?? `KSEF-${Date.now().toString(36)}`;
              updateSale({ ...inv, status: 'w_ksef', ksefId: id });
              download(`KSEF-${inv.numer.replaceAll('/', '-')}.json`, buildKsefStub(inv).payload);
            }}
          >
            Wyślij do KSeF
          </button>
        )}
        {inv.status !== 'robocza' && (
          <button
            className="btn secondary small"
            onClick={() => updateSale({ ...inv, zaplacona: !inv.zaplacona })}
          >
            {inv.zaplacona ? 'Cofnij opłacenie' : 'Oznacz jako opłaconą'}
          </button>
        )}
        <button className="btn secondary small" onClick={onDuplicate}>
          Duplikuj
        </button>
        <button className="btn secondary small" onClick={onKorekta}>
          Faktura korygująca
        </button>
        <button
          className="btn secondary small"
          onClick={() => download(`KSEF-${inv.numer.replaceAll('/', '-')}.json`, buildKsefStub(inv).payload)}
        >
          Pobierz KSeF JSON
        </button>
        <ConfirmButton onConfirm={() => removeSale(inv.id)} />
      </div>
      {inv.status !== 'robocza' && (
        <div className="muted" style={{ marginTop: 8 }}>
          Faktura wystawiona — edycja zablokowana (korekta przez duplikat lub usunięcie i wystawienie na nowo).
        </div>
      )}
    </div>
  );
}

function blankItem(): InvoiceItem {
  return { nazwa: '', ilosc: 1, cenaNetto: 0, stawkaVat: 0.23 };
}

function InvoiceModal({
  initial,
  existing,
  onClose,
}: {
  initial?: SalesInvoice;
  existing: SalesInvoice[];
  onClose: () => void;
}): JSX.Element {
  const today = todayISO();
  const { contractors, settings } = useStore();
  const isRyczalt = settings.formaOpodatkowania === 'ryczalt';
  const [kontrahentId, setKontrahentId] = useState(initial?.kontrahent.id ?? '');
  const [numer, setNumer] = useState(
    initial?.numer ?? nastepnyNumer(existing, initial?.dataSprzedazy ?? today),
  );
  const [nazwa, setNazwa] = useState(initial?.kontrahent.nazwa ?? '');
  const [nip, setNip] = useState(initial?.kontrahent.nip ?? '');
  const [adres, setAdres] = useState(initial?.kontrahent.adres ?? '');
  const [email, setEmail] = useState(initial?.kontrahent.email ?? '');
  const [dataWyst, setDataWyst] = useState(initial?.dataWystawienia ?? today);
  const [dataSprz, setDataSprz] = useState(initial?.dataSprzedazy ?? today);
  const [termin, setTermin] = useState(initial?.terminPlatnosci ?? addDaysISO(today, 14));
  const [items, setItems] = useState<InvoiceItem[]>(
    initial ? structuredClone(initial.pozycje) : [{ ...blankItem(), nazwa: 'Usługi programistyczne' }],
  );
  const [waluta, setWaluta] = useState(initial?.waluta ?? 'PLN');
  const [kursNbp, setKursNbp] = useState(initial?.kursNbp !== undefined ? String(initial.kursNbp) : '');
  const [mpp, setMpp] = useState(initial?.mpp ?? false);
  const [rachunek, setRachunek] = useState(initial?.rachunekBankowy ?? '');
  const [bialaLista, setBialaLista] = useState(initial?.bialaListaSprawdzona ?? '');

  function pickContractor(id: string): void {
    setKontrahentId(id);
    const found = contractors.find((k) => k.id === id);
    if (found) {
      setNazwa(found.nazwa);
      setNip(found.nip);
      setAdres(found.adres);
      setEmail(found.email ?? '');
    }
  }

  function fillFromRegistry(s: { nazwa: string; nip: string; adres: string; email?: string }): void {
    setNazwa(s.nazwa);
    setNip(s.nip);
    if (s.adres) setAdres(s.adres);
    if (s.email) setEmail(s.email);
  }

  const draft: SalesInvoice = {
    id: initial?.id ?? 'draft',
    numer,
    kontrahent: { id: kontrahentId || initial?.kontrahent.id || uid('k'), nazwa, nip: nip.replace(/\D/g, ''), adres, email: email || undefined },
    dataWystawienia: dataWyst,
    dataSprzedazy: dataSprz,
    terminPlatnosci: termin,
    pozycje: items,
    status: initial?.status ?? 'robocza',
    zaplacona: initial?.zaplacona,
    waluta: waluta.trim() || undefined,
    kursNbp: kursNbp.trim() === '' ? undefined : Number(kursNbp),
    mpp: mpp || undefined,
    rachunekBankowy: rachunek.trim() || undefined,
    bialaListaSprawdzona: bialaLista.trim() || undefined,
  };
  const totals = salesVat(draft);

  const nipDigits = nip.replace(/\D/g, '');
  const nipWarn = nipDigits.length > 0 && !isValidNip(nipDigits) ? 'NIP wygląda na nieprawidłowy (błędna suma kontrolna).' : undefined;
  const duplikat = existing.some((s) => s.numer === numer.trim() && s.id !== initial?.id);
  const itemsValid = items.length > 0 && items.every((p) => p.nazwa.trim() && p.ilosc > 0 && p.cenaNetto >= 0);
  const canSave = numer.trim().length > 0 && nazwa.trim().length > 0 && itemsValid && dataSprz.length === 10;

  function save(asIssued: boolean): void {
    if (!canSave) return;
    const inv: SalesInvoice = {
      ...draft,
      numer: numer.trim(),
      kontrahent: { ...draft.kontrahent, nazwa: nazwa.trim() },
      status: asIssued ? 'wystawiona' : (initial?.status ?? 'robocza'),
    };
    if (initial) updateSale({ ...inv, id: initial.id });
    else addSale({ ...inv, id: uid('fv') });
    onClose();
  }

  function setItem(i: number, patch: Partial<InvoiceItem>): void {
    setItems((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  return (
    <Modal
      title={initial ? `Edytuj fakturę ${initial.numer}` : 'Nowa faktura sprzedaży'}
      onClose={onClose}
      wide
      foot={
        <>
          <button className="btn secondary" onClick={onClose}>
            Anuluj
          </button>
          {!initial && (
            <button className="btn secondary" disabled={!canSave} onClick={() => save(false)}>
              Zapisz roboczą
            </button>
          )}
          <button className="btn" disabled={!canSave} onClick={() => save(true)}>
            {initial ? 'Zapisz' : 'Zapisz i wystaw'}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Numer faktury" error={duplikat ? 'Taki numer już istnieje.' : undefined}>
          <input value={numer} onChange={(e) => setNumer(e.target.value)} placeholder="np. 3/2026" />
        </Field>
        <Field label="Data wystawienia">
          <input type="date" value={dataWyst} onChange={(e) => setDataWyst(e.target.value)} />
        </Field>
        <Field label="Data sprzedaży">
          <input type="date" value={dataSprz} onChange={(e) => setDataSprz(e.target.value)} />
        </Field>
        <Field label="Termin płatności">
          <input type="date" value={termin} onChange={(e) => setTermin(e.target.value)} />
        </Field>
      </div>

      <div>
        <h4 style={{ margin: '4px 0 8px' }}>Kontrahent</h4>
        {contractors.length > 0 && (
          <Field label="Wybierz z bazy kontrahentów">
            <select value={kontrahentId} onChange={(e) => pickContractor(e.target.value)}>
              <option value="">— wpisz ręcznie —</option>
              {contractors.map((k: ContractorFull) => (
                <option key={k.id} value={k.id}>{k.nazwa} ({k.nip})</option>
              ))}
            </select>
          </Field>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <Field label="Nazwa">
            <input
              value={nazwa}
              onChange={(e) => setNazwa(e.target.value)}
              placeholder="Acme Sp. z o.o."
            />
          </Field>
          <Field label="NIP" error={nipWarn}>
            <input value={nip} onChange={(e) => setNip(e.target.value)} placeholder="10 cyfr" inputMode="numeric" />
          </Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <RegistrySearch nip={nip} onFill={fillFromRegistry} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Field label="Adres">
            <input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="ulica, miasto" />
          </Field>
          <Field label="E-mail (opcjonalnie)">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="fv@klient.pl" />
          </Field>
        </div>
      </div>

      <div>
        <h4 style={{ margin: '4px 0 8px' }}>Płatność i waluta</h4>
        <div className="row">
          <Field label="Waluta">
            <select value={waluta} onChange={(e) => setWaluta(e.target.value)}>
              {['PLN', 'EUR', 'USD', 'GBP', 'CHF'].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </Field>
          {waluta !== 'PLN' && (
            <Field label="Kurs NBP" hint="Średni kurs NBP z dnia roboczego poprzedzającego sprzedaż (VAT w PLN).">
              <input
                type="number"
                min={0}
                step="any"
                value={kursNbp}
                onChange={(e) => setKursNbp(e.target.value)}
                placeholder="np. 4,32"
              />
            </Field>
          )}
          <Field label="Rachunek bankowy" hint="Numer rachunku do zapłaty — przy >15k zł musi być na Białej Liście.">
            <input
              value={rachunek}
              onChange={(e) => setRachunek(e.target.value)}
              placeholder="PL …"
              inputMode="numeric"
            />
          </Field>
        </div>
        <label className="inline">
          <input type="checkbox" checked={mpp} onChange={(e) => setMpp(e.target.checked)} />
          Mechanizm podzielonej płatności (MPP)
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <Field label="Biała Lista sprawdzona" hint="Znacznik czasu sprawdzenia rachunku (ISO).">
            <input
              value={bialaLista}
              onChange={(e) => setBialaLista(e.target.value)}
              placeholder="rrrr-mm-ddThh:mm:ss"
            />
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <button
              className="btn secondary small"
              onClick={() => setBialaLista(new Date().toISOString())}
            >
              Sprawdź teraz
            </button>
          </div>
        </div>
        {totals.brutto > 15000 && (
          <div className="warn" style={{ marginTop: 8 }}>
            Brutto powyżej 15 000 zł — sprawdź Białą Listę w dniu zlecenia lub MPP/ZAW-NR 7d.
          </div>
        )}
      </div>

      <div>
        <h4 style={{ margin: '4px 0 8px' }}>Pozycje</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nazwa</th><th className="num">Ilość</th><th className="num">Cena netto</th><th>VAT</th>{isRyczalt && <th>Ryczałt</th>}<th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={i}>
                  <td><input value={p.nazwa} onChange={(e) => setItem(i, { nazwa: e.target.value })} placeholder="Usługa…" /></td>
                  <td><input type="number" min={0} step="any" value={p.ilosc} onChange={(e) => setItem(i, { ilosc: Number(e.target.value) })} style={{ maxWidth: 90 }} /></td>
                  <td><input type="number" min={0} step="any" value={p.cenaNetto} onChange={(e) => setItem(i, { cenaNetto: Number(e.target.value) })} style={{ maxWidth: 130 }} /></td>
                  <td>
                    <select
                      value={String(p.stawkaVat)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v: VatRate = raw === 'zw' || raw === 'np' || raw === 'oo' ? raw : (Number(raw) as VatRate);
                        setItem(i, { stawkaVat: v });
                      }}
                      style={{ maxWidth: 90 }}
                    >
                      {VAT_OPTIONS.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  {isRyczalt && (
                    <td>
                      <select
                        value={p.stawkaRyczaltu === undefined ? '' : String(p.stawkaRyczaltu)}
                        onChange={(e) => setItem(i, { stawkaRyczaltu: e.target.value === '' ? undefined : Number(e.target.value) })}
                        style={{ maxWidth: 130 }}
                        title="Stawka ryczałtu dla pozycji (pusta = domyślna z ustawień)"
                      >
                        <option value="">domyślna ({(settings.stawkaRyczaltu * 100).toFixed(settings.stawkaRyczaltu < 0.1 ? 1 : 0)}%)</option>
                        {RYCZALT.map((o) => (
                          <option key={o.stawka} value={String(o.stawka)}>{(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}% — {o.tytul}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td>
                    <button className="btn ghost small" disabled={items.length <= 1} onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => setItems((prev) => [...prev, blankItem()])}>
          + Dodaj pozycję
        </button>
        {!itemsValid && <div className="field-error" style={{ marginTop: 6 }}>Każda pozycja potrzebuje nazwy, ilości &gt; 0 i ceny ≥ 0.</div>}
      </div>

      <div className="totals">
        <span className="t">Netto<b>{fmtMoney(totals.netto)}</b></span>
        <span className="t">VAT<b>{fmtMoney(totals.vat)}</b></span>
        <span className="t grand">Brutto<b>{fmtMoney(totals.brutto)}</b></span>
      </div>
    </Modal>
  );
}
