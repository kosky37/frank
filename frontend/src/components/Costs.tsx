import { Fragment, useEffect, useMemo, useState, type JSX } from 'react';
import type { CostCategory, CostInvoice, VehicleUsage } from '../../src-shared/tax/types.js';
import { deductibleCostPit, deductibleVatCost, round2, vatForNetto } from '../../src-shared/tax/vat.js';
import { addCost, removeCost, updateCost, uid, useStore } from '../lib/store.js';
import { fmtMoney, formatDataPL, isValidNip, monthLabel, todayISO, vatLabel, VAT_OPTIONS } from '../lib/format.js';
import { useRoute, useSubTab, zuzyjAkcje } from '../lib/router.js';
import { Badge, ConfirmButton, Empty, Field, Icon, Menu, Modal, Pills, Tabs, toast } from './ui.js';
import { Majatek } from './Majatek.js';

/** Szablony najczęstszych kosztów — otwierają formularz z wypełnioną kategorią. */
const SZABLONY: { label: string; szablon: Partial<CostInvoice> }[] = [
  { label: 'Paliwo', szablon: { kategoria: 'paliwo', pojazdowy: true, wystawca: 'Stacja paliw', opis: 'Paliwo' } },
  { label: 'Paragon bez NIP', szablon: { kategoria: 'inne', vatNaliczonyDowolny: 0, opis: 'Paragon' } },
  { label: 'Abonament / oprogramowanie', szablon: { kategoria: 'oprogramowanie', opis: 'Subskrypcja' } },
  { label: 'Telefon / internet', szablon: { kategoria: 'uslugi', opis: 'Abonament telekomunikacyjny' } },
  { label: 'Księgowość / bank', szablon: { kategoria: 'uslugi', stawkaVat: 'zw', opis: 'Opłaty bankowe' } },
];

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

/**
 * Import wyciągu bankowego: data;opis;kwota (mBank/ING/PKO — separator ; lub ,).
 * Ujemne kwoty = wydatki (bierzemy |kwota| jako netto, VAT 23% do ręcznej korekty).
 * Zwraca wiersze kosztowe z wystawcą = opis operacji.
 */
export function parseBankCsv(text: string): CsvCostRow[] {
  const rows: CsvCostRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const delim = line.includes(';') ? ';' : ',';
    const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 3) continue;
    // znajdź datę i kwotę w wierszu
    let data = '';
    let kwota = 0;
    let opis = '';
    for (const c of cols) {
      if (!data && (/^\d{4}-\d{2}-\d{2}$/.test(c) || /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.test(c))) {
        data = normDate(c);
      }
    }
    // kwota = ostatnia liczba w wierszu
    for (let i = cols.length - 1; i >= 0; i--) {
      const n = normNumber(cols[i]);
      if (Number.isFinite(n) && n !== 0 && !/^\d{4}-\d{2}-\d{2}$/.test(cols[i])) {
        kwota = n;
        opis = cols.slice(0, i).concat(cols.slice(i + 1)).filter((x) => x && !/^\d{4}-\d{2}-\d{2}$/.test(x)).join(' • ').slice(0, 120);
        break;
      }
    }
    if (!data || !(Math.abs(kwota) > 0)) continue;
    if (kwota > 0) continue; // wpływy pomijamy w kosztach
    rows.push({
      numer: `WB/${data}`,
      wystawca: opis || 'Wyciąg bankowy',
      data,
      netto: Math.abs(kwota),
      stawkaVat: 0.23,
      kategoria: 'inne',
    });
  }
  return rows;
}

const KEY_FOTO = 'frank-cost-photos';

export function wczytajFotoKosztu(id: string): string | null {
  try {
    const mapa = JSON.parse(localStorage.getItem(KEY_FOTO) ?? '{}') as Record<string, string>;
    return mapa[id] ?? null;
  } catch {
    return null;
  }
}

export function zapiszFotoKosztu(id: string, dataUrl: string): void {
  try {
    const mapa = JSON.parse(localStorage.getItem(KEY_FOTO) ?? '{}') as Record<string, string>;
    // limit ~40 zdjęć po ~200KB — localStorage ma ~5MB
    mapa[id] = dataUrl;
    localStorage.setItem(KEY_FOTO, JSON.stringify(mapa));
  } catch {
    /* ignore — za duże zdjęcie */
  }
}

export function CostsTab(): JSX.Element {
  const [tab, setTab] = useSubTab('koszty', ['lista', 'majatek'] as const, 'lista');
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Koszty</h2>
          <p>Faktury zakupowe, paragony i środki trwałe</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'lista', label: 'Dokumenty kosztowe' }, { id: 'majatek', label: 'Środki trwałe i amortyzacja' }]} />
      {tab === 'lista' ? <KosztyLista /> : <Majatek />}
    </>
  );
}

function KosztyLista(): JSX.Element {
  const { costs, settings } = useStore();
  const route = useRoute();
  const [q, setQ] = useState('');
  const [kat, setKat] = useState<CostCategory | 'all'>('all');
  const [miesiac, setMiesiac] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create'; szablon?: Partial<CostInvoice> } | { mode: 'edit'; cost: CostInvoice } | null>(null);
  const vatowiec = settings.vatowiec;
  const akcja = route.page === 'koszty' ? route.akcja : undefined;
  useEffect(() => {
    if (akcja === 'nowy') {
      setModal({ mode: 'create' });
      zuzyjAkcje('koszty', 'lista');
    }
  }, [akcja]);
  const [csvRows, setCsvRows] = useState<CsvCostRow[]>([]);
  const [csvKind, setCsvKind] = useState<'koszty' | 'bank'>('koszty');

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
  const sumaPit = filtered.reduce((a, c) => a + deductibleCostPit(c, vatowiec), 0);
  const sumaVat = filtered.reduce((a, c) => a + deductibleVatCost(c, vatowiec), 0);

  async function onCsvFile(file: File): Promise<void> {
    const text = await file.text();
    const standard = parseCostsCsv(text);
    if (standard.length > 0) {
      setCsvRows(standard);
      setCsvKind('koszty');
    } else {
      const bank = parseBankCsv(text);
      setCsvRows(bank);
      setCsvKind('bank');
    }
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
        opis: csvKind === 'bank' ? `import WB: ${r.wystawca}` : 'import CSV',
      });
    }
    toast(`Zaimportowano ${csvRows.length} kosztów`);
    setCsvRows([]);
  }

  return (
    <>
      {!settings.vat26Zgloszony && settings.uzytkowaniePojazdu === 'wylacznie_firma' && (
        <div className="warn" style={{ marginBottom: 12 }}>
          Pojazd „wyłącznie firmowy” wymaga zgłoszenia VAT-26 do urzędu — inaczej zastosuj „mieszany” (50% VAT / 75% PIT).
        </div>
      )}
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="muted">
          {filtered.length} z {costs.length} • netto <b>{fmtMoney(sumaNetto)}</b> • koszt w PIT <b>{fmtMoney(sumaPit)}</b>
          {vatowiec && <> • VAT do odliczenia <b>{fmtMoney(sumaVat)}</b></>}
        </div>
        <div className="page-actions">
          <Menu
            label="Szablon"
            icon="receipt"
            small={false}
            items={SZABLONY.map((s) => ({ label: s.label, onClick: () => setModal({ mode: 'create', szablon: s.szablon }) }))}
          />
          <label className="btn secondary" style={{ cursor: 'pointer' }} title="CSV kosztów (numer;wystawca;data;netto;vat;kategoria) lub wyciąg bankowy (data;opis;kwota)">
            <Icon name="upload" size={15} /> Import CSV
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
            <Icon name="plus" size={16} /> Nowy koszt
          </button>
        </div>
      </div>
      {csvRows.length > 0 && (
        <div className="info" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            Podgląd importu ({csvKind === 'bank' ? 'wyciąg bankowy — wydatki jako koszty, VAT do weryfikacji' : 'numer;wystawca;data;netto;vat;kategoria'}): <b>{csvRows.length}</b> wierszy.
          </span>
          <button className="btn small" onClick={importCsvRows}>
            Importuj {csvRows.length} pozycji
          </button>
          <button className="btn secondary small" onClick={() => setCsvRows([])}>
            Odrzuć
          </button>
        </div>
      )}

      <div className="card flush">
        <div className="toolbar" style={{ padding: '14px 16px 12px', margin: 0 }}>
          <div className="search">
            <Icon name="search" size={16} />
            <input className="compact" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, wystawca, opis…" />
          </div>
          <select aria-label="Filtr kategorii kosztu" className="compact" value={kat} onChange={(e) => setKat(e.target.value as CostCategory | 'all')}>
            <option value="all">Wszystkie kategorie</option>
            {KATEGORIE.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select aria-label="Filtr miesiąca kosztu" className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
            <option value="all">Wszystkie miesiące</option>
            {miesiace.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
        {filtered.length === 0 ? (
          <Empty
            icon="receipt"
            title={costs.length === 0 ? 'Brak kosztów' : 'Brak wyników'}
            hint={costs.length === 0 ? 'Dodaj fakturę zakupową, paragon albo zaimportuj wyciąg bankowy (CSV).' : 'Zmień filtry lub wyczyść wyszukiwanie.'}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dokument</th><th>Księgowanie</th><th>Kategoria</th>
                  <th className="num">Netto</th><th className="num">Koszt PIT</th>{vatowiec && <th className="num">VAT odlicz.</th>}<th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isOpen = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className={`clickable${isOpen ? ' expanded' : ''}`} onClick={() => setExpanded(isOpen ? null : c.id)}>
                        <td><b>{c.wystawca}</b><span className="sub">{c.numer}</span></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDataPL(c.dataKsiegowania)}</td>
                        <td>
                          {katLabel(c.kategoria)}{' '}
                          {c.pojazdowy && <Badge tone="amber">pojazd</Badge>}{' '}
                          {c.nieodliczalnyArt23 && <Badge tone="red">art. 23</Badge>}
                        </td>
                        <td className="num">{fmtMoney(c.netto)}</td>
                        <td className="num">{fmtMoney(deductibleCostPit(c, vatowiec))}</td>
                        {vatowiec && <td className="num">{fmtMoney(deductibleVatCost(c, vatowiec))}</td>}
                        <td className="actions">
                          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={16} className="muted" />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail">
                          <td colSpan={vatowiec ? 7 : 6}>
                            <div className="detail-grid">
                              <div>
                                <h4>Dokument</h4>
                                <div className="muted">Zakup: {formatDataPL(c.dataZakupu)}</div>
                                <div className="muted">NIP wystawcy: {c.nipWystawcy || '—'}</div>
                                <div className="muted">Opis: {c.opis || '—'}</div>
                                <FotoKosztu costId={c.id} />
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
                                <Icon name="edit" size={14} /> Edytuj
                              </button>
                              <button
                                className="btn secondary small"
                                onClick={() => setModal({ mode: 'create', szablon: { ...c, id: undefined, numer: '', dataZakupu: todayISO(), dataKsiegowania: todayISO() } })}
                              >
                                <Icon name="copy" size={14} /> Duplikuj
                              </button>
                              <ConfirmButton onConfirm={() => { removeCost(c.id); toast(`Usunięto koszt ${c.numer}`); }} />
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
          szablon={modal.mode === 'create' ? modal.szablon : undefined}
          defaultUsage={settings.uzytkowaniePojazdu}
          vatowiec={vatowiec}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function FotoKosztu({ costId }: { costId: string }): JSX.Element {
  const [foto, setFoto] = useState<string | null>(() => wczytajFotoKosztu(costId));

  function onFile(f: File): void {
    if (!f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      // downscale do max 1200px, by nie przepełnić localStorage
      const img = new Image();
      img.onload = () => {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const small = canvas.toDataURL('image/jpeg', 0.8);
        zapiszFotoKosztu(costId, small);
        setFoto(small);
      };
      img.src = url;
    };
    reader.readAsDataURL(f);
  }

  return (
    <div style={{ marginTop: 8 }}>
      {foto ? (
        <div>
          <img src={foto} alt="Paragon / faktura kosztowa" style={{ maxWidth: 220, borderRadius: 8, border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <a className="btn secondary small" href={foto} download={`koszt-${costId}.jpg`}>Pobierz zdjęcie</a>
            <label className="btn secondary small" style={{ cursor: 'pointer' }}>
              Zmień zdjęcie
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            </label>
          </div>
        </div>
      ) : (
        <label className="btn secondary small" style={{ cursor: 'pointer' }} title="Zdjęcie paragonu/faktury — trzymane lokalnie w przeglądarce">
          + Dodaj zdjęcie paragonu
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}

function CostModal({
  initial,
  szablon,
  defaultUsage,
  vatowiec,
  onClose,
}: {
  initial?: CostInvoice;
  szablon?: Partial<CostInvoice>;
  defaultUsage: VehicleUsage;
  vatowiec: boolean;
  onClose: () => void;
}): JSX.Element {
  const today = todayISO();
  const p = initial ?? szablon;
  const [numer, setNumer] = useState(p?.numer ?? '');
  const [wystawca, setWystawca] = useState(p?.wystawca ?? '');
  const [nip, setNip] = useState(p?.nipWystawcy ?? '');
  const [dataZ, setDataZ] = useState(p?.dataZakupu ?? today);
  const [dataK, setDataK] = useState(p?.dataKsiegowania ?? today);
  const [kategoria, setKategoria] = useState<CostCategory>(p?.kategoria ?? 'uslugi');
  const [pojazdowy, setPojazdowy] = useState(p?.pojazdowy ?? false);
  const [uzycie, setUzycie] = useState<VehicleUsage>(p?.uzytkowaniePojazdu ?? defaultUsage);
  const [tryb, setTryb] = useState<'netto' | 'brutto'>('netto');
  const [kwota, setKwota] = useState(p?.netto !== undefined ? String(p.netto) : '');
  const [stawka, setStawka] = useState<string>(p?.stawkaVat !== undefined ? String(p.stawkaVat) : '0.23');
  const [vatOverride, setVatOverride] = useState(p?.vatNaliczonyDowolny !== undefined ? String(p.vatNaliczonyDowolny) : '');
  const [opis, setOpis] = useState(p?.opis ?? '');
  const [art23, setArt23] = useState(p?.nieodliczalnyArt23 ?? false);

  const stawkaVat: CostInvoice['stawkaVat'] =
    stawka === 'zw' || stawka === 'np' || stawka === 'oo' ? stawka : (Number(stawka) as CostInvoice['stawkaVat']);
  const kwotaNum = Number(kwota.replace(',', '.')) || 0;
  const stopa = typeof stawkaVat === 'number' ? stawkaVat : 0;
  const nettoNum = tryb === 'brutto' ? round2(kwotaNum / (1 + stopa)) : kwotaNum;
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
    stawkaVat,
    vatNaliczonyDowolny: vatOverride.trim() === '' ? undefined : Number(vatOverride.replace(',', '.')),
    opis: opis.trim(),
    nieodliczalnyArt23: art23 || undefined,
  };
  const vatAuto = tryb === 'brutto' ? round2(kwotaNum - nettoNum) : vatForNetto(nettoNum, stawkaVat).vat;
  const vatOdlicz = deductibleVatCost(draft, vatowiec);
  const kosztPit = deductibleCostPit(draft, vatowiec);

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
    toast(initial ? 'Zapisano koszt' : `Dodano koszt ${draft.numer}`);
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
        <Field
          label={`Kwota ${tryb} (zł)`}
          hint={tryb === 'brutto' && kwotaNum > 0 ? `netto ${fmtMoney(nettoNum)} + VAT ${fmtMoney(vatAuto)}` : undefined}
        >
          <input type="number" min={0} step="any" value={kwota} onChange={(e) => setKwota(e.target.value)} placeholder="0,00" />
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <Pills
          label="Kwota netto czy brutto"
          value={tryb}
          onChange={setTryb}
          options={[{ id: 'netto', label: 'Wpisuję netto' }, { id: 'brutto', label: 'Wpisuję brutto' }]}
        />
        {vatowiec && (
          <button className="btn secondary small" onClick={() => setVatOverride('0')}>
            Paragon bez NIP (VAT 0)
          </button>
        )}
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
      {kategoria === 'sprzet' && (vatowiec ? nettoNum : nettoNum + vatAuto) > 10000 && (
        <div className="warn" style={{ marginTop: 8 }}>
          Sprzęt powyżej 10 000 zł {vatowiec ? 'netto' : 'brutto'} to środek trwały — zamiast jednorazowego kosztu wpisz go
          w zakładce „Środki trwałe i amortyzacja” (jednorazowa amortyzacja możliwa w ramach de minimis).
          {nettoNum > 100000 && ' Dla samochodów sprawdź limit 2026: elektryczny 225 tys., <50 g CO₂ 150 tys., spalinowy 100 tys.'}
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
        <span className={`t${vatowiec ? '' : ' grand'}`}>Koszt PIT<b>{fmtMoney(kosztPit)}</b></span>
        {vatowiec && <span className="t grand">VAT do odliczenia<b>{fmtMoney(vatOdlicz)}</b></span>}
      </div>
    </Modal>
  );
}
