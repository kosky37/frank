import { Fragment, useMemo, useState, type JSX } from 'react';
import type { CostCategory, CostInvoice, VehicleUsage } from '../../src-shared/tax/types.js';
import { deductibleCostPit, deductibleVatCost, vatForNetto } from '../../src-shared/tax/vat.js';
import { addCost, removeCost, updateCost, uid, useStore } from '../lib/store.js';
import { fmtMoney, isValidNip, monthLabel, todayISO, vatLabel, VAT_OPTIONS } from '../lib/format.js';
import { Badge, ConfirmButton, Empty, Field, Modal } from './ui.js';

const KATEGORIE: { value: CostCategory; label: string }[] = [
  { value: 'paliwo', label: 'Paliwo' },
  { value: 'eksploatacja_pojazdu', label: 'Eksploatacja pojazdu' },
  { value: 'sprzet', label: 'Sprzęt' },
  { value: 'oprogramowanie', label: 'Oprogramowanie' },
  { value: 'uslugi', label: 'Usługi' },
  { value: 'biuro', label: 'Biuro' },
  { value: 'inne', label: 'Inne' },
];

const UZYCIE: { value: VehicleUsage; label: string }[] = [
  { value: 'mieszany', label: 'Mieszane — 50% VAT / 75% PIT' },
  { value: 'wylacznie_firma', label: 'Wyłącznie firma — 100% (VAT-26)' },
  { value: 'prywatny', label: 'Prywatne — 0%' },
];

function katLabel(k: CostCategory): string {
  return KATEGORIE.find((x) => x.value === k)?.label ?? k;
}

interface CsvCostRow {
  numer: string;
  wystawca: string;
  data: string; // ISO yyyy-mm-dd
  netto: number;
  stawkaVat: CostInvoice['stawkaVat'];
  vatNaliczonyDowolny?: number;
  kategoria: CostCategory;
}

function normDate(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return t;
}

function normNumber(raw: string): number {
  return Number(raw.trim().replace(/\s/g, '').replace(',', '.'));
}

function normVat(raw: string): { stawkaVat: CostInvoice['stawkaVat']; vatNaliczonyDowolny?: number } {
  const t = raw.trim().toLowerCase().replace('%', '').replace(',', '.');
  if (t === '' ) return { stawkaVat: 0.23 };
  if (t === 'zw') return { stawkaVat: 'zw' };
  if (t === 'np') return { stawkaVat: 'np' };
  if (t === 'oo') return { stawkaVat: 'oo' };
  const n = Number(t);
  if (n === 23 || n === 0.23) return { stawkaVat: 0.23 };
  if (n === 8 || n === 0.08) return { stawkaVat: 0.08 };
  if (n === 5 || n === 0.05) return { stawkaVat: 0.05 };
  if (n === 0) return { stawkaVat: 0 };
  if (!Number.isNaN(n)) return { stawkaVat: 0.23, vatNaliczonyDowolny: n };
  return { stawkaVat: 0.23 };
}

function normKategoria(raw: string): CostCategory {
  const t = raw.trim().toLowerCase();
  const found = KATEGORIE.find((k) => k.value === t || k.label.toLowerCase() === t);
  return found?.value ?? 'inne';
}

/** Parsuje CSV "numer;wystawca;data;netto;vat;kategoria" (toleruje , i ; oraz nagłówek). */
export function parseCostsCsv(text: string): CsvCostRow[] {
  const rows: CsvCostRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const delim = line.includes(';') ? ';' : ',';
    const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;
    const netto = normNumber(cols[3] ?? '');
    if (!(netto > 0)) {
      // prawdopodobnie nagłówek (np. "netto") — pomiń
      continue;
    }
    const vat = normVat(cols[4] ?? '');
    rows.push({
      numer: cols[0] || '—',
      wystawca: cols[1] || '—',
      data: normDate(cols[2] || todayISO()),
      netto,
      ...vat,
      kategoria: normKategoria(cols[5] ?? ''),
    });
  }
  return rows;
}

export function CostsTab(): JSX.Element {
  const { costs, settings } = useStore();
  const [q, setQ] = useState('');
  const [kat, setKat] = useState<CostCategory | 'all'>('all');
  const [miesiac, setMiesiac] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; cost: CostInvoice } | null>(null);
  const [csvRows, setCsvRows] = useState<CsvCostRow[]>([]);

  const miesiace = useMemo(() => {
    const s = new Set(costs.map((x) => x.dataKsiegowania.slice(0, 7)));
    return [...s].sort().reverse();
  }, [costs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return costs
      .filter((c) => (kat === 'all' ? true : c.kategoria === kat))
      .filter((c) => (miesiac === 'all' ? true : c.dataKsiegowania.startsWith(miesiac)))
      .filter((c) =>
        needle
          ? [c.numer, c.wystawca, c.opis].some((v) => v.toLowerCase().includes(needle))
          : true,
      )
      .sort((a, b) => b.dataKsiegowania.localeCompare(a.dataKsiegowania));
  }, [costs, q, kat, miesiac]);

  const sumaNetto = filtered.reduce((a, c) => a + c.netto, 0);
  const sumaPit = filtered.reduce((a, c) => a + deductibleCostPit(c), 0);
  const sumaVat = filtered.reduce((a, c) => a + deductibleVatCost(c), 0);

  async function onCsvFile(file: File): Promise<void> {
    const text = await file.text();
    setCsvRows(parseCostsCsv(text));
  }

  function importCsvRows(): void {
    for (const r of csvRows) {
      addCost({
        id: uid('koszt'),
        numer: r.numer,
        wystawca: r.wystawca,
        dataZakupu: r.data,
        dataKsiegowania: r.data,
        kategoria: r.kategoria,
        pojazdowy: false,
        uzytkowaniePojazdu: settings.uzytkowaniePojazdu,
        netto: r.netto,
        stawkaVat: r.stawkaVat,
        vatNaliczonyDowolny: r.vatNaliczonyDowolny,
        opis: 'import CSV',
      });
    }
    setCsvRows([]);
  }

  return (
    <>
      {!settings.vat26Zgloszony && settings.uzytkowaniePojazdu === 'wylacznie_firma' && (
        <div className="warn" style={{ marginBottom: 12 }}>
          Pojazd „wyłącznie firmowy” wymaga zgłoszenia VAT-26 do urzędu — inaczej zastosuj „mieszany” (50% VAT / 75% PIT).
        </div>
      )}
      <div className="page-head">
        <div>
          <h2>Koszty</h2>
          <p>
            {filtered.length} z {costs.length} • netto {fmtMoney(sumaNetto)} • w PIT{' '}
            {fmtMoney(sumaPit)} • VAT do odliczenia {fmtMoney(sumaVat)}
          </p>
        </div>
        <div className="page-actions">
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            Import CSV
            <input
              type="file"
              accept=".csv,.txt"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCsvFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn" onClick={() => setModal({ mode: 'create' })}>
            + Nowy koszt
          </button>
        </div>
      </div>
      {csvRows.length > 0 && (
        <div className="info" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            Podgląd importu: <b>{csvRows.length}</b> wierszy (numer;wystawca;data;netto;vat;kategoria).
          </span>
          <button className="btn small" onClick={importCsvRows}>
            Importuj {csvRows.length} pozycji
          </button>
          <button className="btn secondary small" onClick={() => setCsvRows([])}>
            Odrzuć
          </button>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, wystawca, opis…" />
          </div>
          <select className="compact" value={kat} onChange={(e) => setKat(e.target.value as CostCategory | 'all')}>
            <option value="all">Wszystkie kategorie</option>
            {KATEGORIE.map((o) => (
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
            title={costs.length === 0 ? 'Brak kosztów' : 'Brak wyników'}
            hint="Dodaj koszt przyciskiem powyżej — np. paliwo, sprzęt, oprogramowanie."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Numer</th><th>Wystawca</th><th>Księgowanie</th><th>Kategoria</th>
                  <th className="num">Netto</th><th className="num">Koszt PIT</th><th className="num">VAT odlicz.</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isOpen = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className={isOpen ? 'expanded' : ''}>
                        <td><b>{c.numer}</b></td>
                        <td>{c.wystawca}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.dataKsiegowania}</td>
                        <td>
                          {katLabel(c.kategoria)}{' '}
                          {c.pojazdowy && <Badge tone="amber">pojazd</Badge>}{' '}
                          {c.nieodliczalnyArt23 && <Badge tone="red">art. 23</Badge>}
                        </td>
                        <td className="num">{fmtMoney(c.netto)}</td>
                        <td className="num">{fmtMoney(deductibleCostPit(c))}</td>
                        <td className="num">{fmtMoney(deductibleVatCost(c))}</td>
                        <td className="actions">
                          <button className="btn ghost small" onClick={() => setExpanded(isOpen ? null : c.id)}>
                            {isOpen ? 'Zwiń' : 'Podgląd'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail">
                          <td colSpan={8}>
                            <div className="detail-grid">
                              <div>
                                <h4>Dokument</h4>
                                <div className="muted">Zakup: {c.dataZakupu}</div>
                                <div className="muted">NIP wystawcy: {c.nipWystawcy || '—'}</div>
                                <div className="muted">Opis: {c.opis || '—'}</div>
                              </div>
                              <div>
                                <h4>Odliczenia</h4>
                                <div className="muted">
                                  VAT: {vatLabel(c.stawkaVat)}
                                  {c.vatNaliczonyDowolny !== undefined && ` (z dokumentu ${fmtMoney(c.vatNaliczonyDowolny)})`}
                                </div>
                                {c.pojazdowy && (
                                  <div className="muted">
                                    Użycie: {UZYCIE.find((u) => u.value === c.uzytkowaniePojazdu)?.label}
                                  </div>
                                )}
                                {c.nieodliczalnyArt23 && (
                                  <div className="muted">
                                    reprezentacja/prywatny (art. 23 — brak KUP i VAT)
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                              <button
                                className="btn secondary small"
                                onClick={() => setModal({ mode: 'edit', cost: c })}
                              >
                                Edytuj
                              </button>
                              <ConfirmButton onConfirm={() => removeCost(c.id)} />
                            </div>
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
        <CostModal
          key={modal.mode === 'edit' ? modal.cost.id : 'new'}
          initial={modal.mode === 'edit' ? modal.cost : undefined}
          defaultUsage={settings.uzytkowaniePojazdu}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function CostModal({
  initial,
  defaultUsage,
  onClose,
}: {
  initial?: CostInvoice;
  defaultUsage: VehicleUsage;
  onClose: () => void;
}): JSX.Element {
  const today = todayISO();
  const [numer, setNumer] = useState(initial?.numer ?? '');
  const [wystawca, setWystawca] = useState(initial?.wystawca ?? '');
  const [nip, setNip] = useState(initial?.nipWystawcy ?? '');
  const [dataZ, setDataZ] = useState(initial?.dataZakupu ?? today);
  const [dataK, setDataK] = useState(initial?.dataKsiegowania ?? today);
  const [kategoria, setKategoria] = useState<CostCategory>(initial?.kategoria ?? 'uslugi');
  const [pojazdowy, setPojazdowy] = useState(initial?.pojazdowy ?? false);
  const [uzycie, setUzycie] = useState<VehicleUsage>(initial?.uzytkowaniePojazdu ?? defaultUsage);
  const [netto, setNetto] = useState(initial ? String(initial.netto) : '');
  const [stawka, setStawka] = useState<string>(
    initial ? String(initial.stawkaVat) : '0.23',
  );
  const [vatOverride, setVatOverride] = useState(initial?.vatNaliczonyDowolny !== undefined ? String(initial.vatNaliczonyDowolny) : '');
  const [opis, setOpis] = useState(initial?.opis ?? '');
  const [art23, setArt23] = useState(initial?.nieodliczalnyArt23 ?? false);

  const nettoNum = Number(netto) || 0;
  const draft: CostInvoice = {
    id: initial?.id ?? 'draft',
    numer: numer.trim(),
    wystawca: wystawca.trim(),
    nipWystawcy: nip.replace(/\D/g, '') || undefined,
    dataZakupu: dataZ,
    dataKsiegowania: dataK,
    kategoria,
    pojazdowy,
    uzytkowaniePojazdu: uzycie,
    netto: nettoNum,
    stawkaVat: stawka === 'zw' || stawka === 'np' || stawka === 'oo' ? stawka : (Number(stawka) as CostInvoice['stawkaVat']),
    vatNaliczonyDowolny: vatOverride.trim() === '' ? undefined : Number(vatOverride),
    opis: opis.trim(),
    nieodliczalnyArt23: art23 || undefined,
  };
  const vatAuto = vatForNetto(nettoNum, draft.stawkaVat).vat;
  const vatOdlicz = deductibleVatCost(draft);
  const kosztPit = deductibleCostPit(draft);

  const nipDigits = nip.replace(/\D/g, '');
  const nipWarn =
    nipDigits.length > 0 && !isValidNip(nipDigits) ? 'NIP wygląda na nieprawidłowy.' : undefined;
  const canSave =
    numer.trim().length > 0 &&
    wystawca.trim().length > 0 &&
    nettoNum > 0 &&
    dataZ.length === 10 &&
    dataK.length === 10;

  function save(): void {
    if (!canSave) return;
    if (initial) updateCost({ ...draft, id: initial.id });
    else addCost({ ...draft, id: uid('koszt') });
    onClose();
  }

  return (
    <Modal
      title={initial ? `Edytuj koszt ${initial.numer}` : 'Nowy koszt'}
      onClose={onClose}
      wide
      foot={
        <>
          <button className="btn secondary" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn" disabled={!canSave} onClick={save}>
            {initial ? 'Zapisz' : 'Dodaj koszt'}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Numer dokumentu">
          <input value={numer} onChange={(e) => setNumer(e.target.value)} placeholder="FV/…" />
        </Field>
        <Field label="Wystawca">
          <input value={wystawca} onChange={(e) => setWystawca(e.target.value)} placeholder="Sklep / stacja…" />
        </Field>
        <Field label="NIP wystawcy (opcjonalnie)" error={nipWarn}>
          <input value={nip} onChange={(e) => setNip(e.target.value)} placeholder="10 cyfr" inputMode="numeric" />
        </Field>
      </div>
      <div className="row">
        <Field label="Data zakupu">
          <input type="date" value={dataZ} onChange={(e) => setDataZ(e.target.value)} />
        </Field>
        <Field label="Data księgowania">
          <input type="date" value={dataK} onChange={(e) => setDataK(e.target.value)} />
        </Field>
        <Field label="Kategoria">
          <select value={kategoria} onChange={(e) => setKategoria(e.target.value as CostCategory)}>
            {KATEGORIE.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Netto (zł)">
          <input type="number" min={0} step="any" value={netto} onChange={(e) => setNetto(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Stawka VAT">
          <select value={stawka} onChange={(e) => setStawka(e.target.value)}>
            {VAT_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="VAT z dokumentu (opcjonalnie)" hint="Zostaw puste = licz z kwoty. Paragon bez NIP → wpisz 0.">
          <input type="number" min={0} step="any" value={vatOverride} onChange={(e) => setVatOverride(e.target.value)} placeholder={`auto: ${vatAuto.toFixed(2)}`} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn secondary small" onClick={() => setVatOverride('0')}>
          Paragon bez NIP (VAT 0)
        </button>
      </div>
      <label className="inline">
        <input type="checkbox" checked={art23} onChange={(e) => setArt23(e.target.checked)} />
        reprezentacja/prywatny (art. 23 — brak KUP i VAT)
      </label>
      {art23 && (
        <div className="info" style={{ marginTop: 6 }}>
          art. 23 — wydatek niestanowiący kosztu uzyskania przychodu: KUP i VAT do odliczenia wynoszą 0.
        </div>
      )}
      {kategoria === 'sprzet' && nettoNum > 100000 && (
        <div className="warn" style={{ marginTop: 8 }}>
          {'sprawdź limit auta 2026: EV 225k/<50g 150k/spal. 100k'}
        </div>
      )}
      <label className="inline">
        <input type="checkbox" checked={pojazdowy} onChange={(e) => setPojazdowy(e.target.checked)} />
        Wydatek związany z pojazdem
      </label>
      {pojazdowy && (
        <Field label="Użytkowanie pojazdu">
          <select value={uzycie} onChange={(e) => setUzycie(e.target.value as VehicleUsage)}>
            {UZYCIE.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Opis">
        <input value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="Za co…" />
      </Field>
      <div className="totals">
        <span className="t">Netto<b>{fmtMoney(nettoNum)}</b></span>
        <span className="t">Koszt PIT<b>{fmtMoney(kosztPit)}</b></span>
        <span className="t grand">VAT do odliczenia<b>{fmtMoney(vatOdlicz)}</b></span>
      </div>
    </Modal>
  );
}
