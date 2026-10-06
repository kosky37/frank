import { useEffect, useMemo, useState, type JSX } from 'react';
import type { InvoiceItem, RodzajFaktury, SalesInvoice, TaxpayerSettings, TrybKsef, VatRate } from '../../src-shared/tax/types.js';
import { brakKursu, salesVat, salesVatPln } from '../../src-shared/tax/vat.js';
import { addDaysISO, fmtMoney, formatDataPL, isValidNip, monthLabel, todayISO, vatLabel, VAT_OPTIONS } from '../lib/format.js';
import { RYCZALT } from '../../src-shared/dictionaries.js';
import { addSale, removeSale, updateSale, uid, useStore } from '../lib/store.js';
import { api, ApiError, type ContractorFull } from '../lib/api.js';
import { fakturaHtml, type Sprzedawca } from '../lib/batchE.js';
import { brakiArt106e, budujDowodBL, danePrzelewu, dniPoTerminie, sprzedazCsv, wczytajLogoUrl } from '../lib/quickwins.js';
import { dzienPoprzedniRoboczy, pobierzKurs } from '../lib/nbp.js';
import { navigate, useRoute, zuzyjAkcje } from '../lib/router.js';
import { Badge, Drawer, Empty, Field, Icon, kopiuj, Menu, Modal, Pills, StatusBadge, toast } from './ui.js';
import { RegistrySearch } from './Contractors.js';

function download(name: string, text: string, type = 'text/plain;charset=utf-8'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
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

/** Etykieta rodzaju dokumentu do badge'y i wydruku. */
export function rodzajLabel(r: RodzajFaktury): string {
  switch (r) {
    case 'korygujaca': return 'korygująca';
    case 'zaliczkowa': return 'zaliczkowa';
    case 'proforma': return 'proforma';
    case 'uproszczona': return 'uproszczona';
    default: return 'sprzedaży';
  }
}

/** Zamienia „MM/RRRR” z miesiąca źródłowego na docelowy w nazwach pozycji (np. „Usługi 09/2026” → „Usługi 10/2026”). */
export function przesunOkresWNazwie(nazwa: string, zIso: string, naIso: string): string {
  const z = `${zIso.slice(5, 7)}/${zIso.slice(0, 4)}`;
  const na = `${naIso.slice(5, 7)}/${naIso.slice(0, 4)}`;
  return z === na ? nazwa : nazwa.split(z).join(na);
}

/** Szablon faktury korygującej: pozycje z ujemną ilością (storno całości), do edycji na różnicę. */
export function szablonKorekty(inv: SalesInvoice, dzis: string): Partial<SalesInvoice> {
  return {
    ...structuredClone(inv),
    id: undefined,
    rodzaj: 'korygujaca',
    korygujeNumer: inv.numer,
    dataWystawienia: dzis,
    dataSprzedazy: inv.dataSprzedazy,
    pozycje: inv.pozycje.map((p) => ({ ...p, ilosc: -p.ilosc })),
    status: 'robocza',
    ksefId: undefined,
    zaplacona: false,
    bialaListaSprawdzona: undefined,
  };
}

export function sprzedawcaZUstawien(s: TaxpayerSettings): Sprzedawca {
  return {
    nazwa: s.firmaNazwa,
    nip: s.firmaNip,
    adres: s.firmaAdres,
    email: s.firmaEmail,
    telefon: s.firmaTelefon,
    rachunek: s.firmaRachunek,
    bank: s.firmaBank,
    vatowiec: s.vatowiec,
    logoUrl: wczytajLogoUrl() || undefined,
  };
}

/** Link mailto z treścią do klienta (PDF dołącza się ręcznie — przeglądarka nie dołączy pliku). */
export function mailtoFaktury(inv: SalesInvoice, s: TaxpayerSettings): string {
  const v = salesVat(inv);
  const waluta = inv.waluta && inv.waluta !== 'PLN' ? inv.waluta : 'PLN';
  const kwota = waluta === 'PLN' ? fmtMoney(v.brutto) : `${v.brutto.toFixed(2)} ${waluta}`;
  const rachunek = inv.rachunekBankowy || s.firmaRachunek;
  const body = [
    'Dzień dobry,',
    '',
    `w załączniku przesyłam fakturę nr ${inv.numer} na kwotę ${kwota} brutto.`,
    `Termin płatności: ${formatDataPL(inv.terminPlatnosci)}.`,
    rachunek ? `Rachunek: ${rachunek}` : '',
    inv.ksefId ? `Numer KSeF: ${inv.ksefId}` : '',
    '',
    'Pozdrawiam',
    s.firmaNazwa ?? '',
  ].filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n');
  const subject = `Faktura ${inv.numer}${s.firmaNazwa ? ` — ${s.firmaNazwa}` : ''}`;
  return `mailto:${encodeURIComponent(inv.kontrahent.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

type Filtr = 'all' | 'nieoplacone' | 'po_terminie' | 'robocze';

type ModalState =
  | { mode: 'create'; szablon?: Partial<SalesInvoice> }
  | { mode: 'edit'; inv: SalesInvoice }
  | null;

function stanPlatnosci(s: SalesInvoice, dzis: string): JSX.Element {
  if (s.status === 'robocza') return <span className="muted">—</span>;
  if (s.rodzaj === 'proforma') return <Badge>proforma</Badge>;
  if (s.zaplacona) return <Badge tone="green">Opłacona</Badge>;
  if (s.terminPlatnosci < dzis) return <Badge tone="red">{dniPoTerminie(s.terminPlatnosci, dzis)} d po terminie</Badge>;
  return <Badge tone="amber">Oczekuje</Badge>;
}

export function SalesTab(): JSX.Element {
  const { sales, settings } = useStore();
  const route = useRoute();
  const [q, setQ] = useState('');
  const [filtr, setFiltr] = useState<Filtr>('all');
  const [miesiac, setMiesiac] = useState('all');
  const [modal, setModal] = useState<ModalState>(null);
  const dzis = todayISO();

  // #/sprzedaz/lista/nowa → formularz; #/sprzedaz/lista/<id> → szczegóły
  const akcja = route.page === 'sprzedaz' ? route.akcja : undefined;
  useEffect(() => {
    if (akcja === 'nowa') {
      setModal({ mode: 'create' });
      zuzyjAkcje('sprzedaz');
    }
  }, [akcja]);
  const otwarta = akcja && akcja !== 'nowa' ? sales.find((s) => s.id === akcja) : undefined;
  const otworz = (id: string): void => navigate('sprzedaz', 'lista', id);
  const zamknij = (): void => navigate('sprzedaz');

  const miesiace = useMemo(() => {
    const s = new Set(sales.map((x) => x.dataSprzedazy.slice(0, 7)));
    return [...s].sort().reverse();
  }, [sales]);

  const czyNieoplacona = (s: SalesInvoice): boolean => s.status !== 'robocza' && s.rodzaj !== 'proforma' && !s.zaplacona;
  const liczby = {
    nieoplacone: sales.filter(czyNieoplacona).length,
    po_terminie: sales.filter((s) => czyNieoplacona(s) && s.terminPlatnosci < dzis).length,
    robocze: sales.filter((s) => s.status === 'robocza').length,
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sales
      .filter((s) =>
        filtr === 'all' ? true
        : filtr === 'robocze' ? s.status === 'robocza'
        : filtr === 'nieoplacone' ? czyNieoplacona(s)
        : czyNieoplacona(s) && s.terminPlatnosci < dzis,
      )
      .filter((s) => (miesiac === 'all' ? true : s.dataSprzedazy.startsWith(miesiac)))
      .filter((s) =>
        needle
          ? [s.numer, s.kontrahent.nazwa, s.kontrahent.nip, ...s.pozycje.map((p) => p.nazwa)].some((v) => v.toLowerCase().includes(needle))
          : true,
      )
      .sort((a, b) => b.dataWystawienia.localeCompare(a.dataWystawienia) || b.numer.localeCompare(a.numer, 'pl', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, q, filtr, miesiac, dzis]);

  const doSumy = filtered.filter((s) => s.rodzaj !== 'proforma');
  const sumaNetto = doSumy.reduce((a, s) => a + salesVatPln(s).netto, 0);
  const sumaBrutto = doSumy.reduce((a, s) => a + salesVatPln(s).brutto, 0);
  const sumaNieoplacone = sales.filter(czyNieoplacona).reduce((a, s) => a + salesVatPln(s).brutto, 0);

  const ostatniaWystawiona = useMemo(
    () =>
      [...sales]
        .filter((s) => s.status !== 'robocza' && (s.rodzaj ?? 'sprzedazy') === 'sprzedazy')
        .sort((a, b) => b.dataWystawienia.localeCompare(a.dataWystawienia))[0],
    [sales],
  );

  function szablonKopii(inv: SalesInvoice): Partial<SalesInvoice> {
    const today = todayISO();
    return {
      ...structuredClone(inv),
      id: undefined,
      numer: undefined,
      dataWystawienia: today,
      dataSprzedazy: today,
      terminPlatnosci: undefined,
      pozycje: inv.pozycje.map((p) => ({ ...p, nazwa: przesunOkresWNazwie(p.nazwa, inv.dataSprzedazy, today) })),
      status: 'robocza',
      ksefId: undefined,
      zaplacona: false,
      bialaListaSprawdzona: undefined,
      kursNbp: undefined,
      korygujeNumer: undefined,
      rodzaj: inv.rodzaj === 'korygujaca' ? undefined : inv.rodzaj,
    };
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Sprzedaż</h2>
          <p>
            {sales.length === 0 ? 'Brak faktur' : <>Do zapłaty od klientów: <b>{fmtMoney(sumaNieoplacone)}</b>{liczby.po_terminie > 0 && <> • <span className="text-red">{liczby.po_terminie} po terminie</span></>}</>}
          </p>
        </div>
        <div className="page-actions">
          <Menu
            small={false}
            items={[
              {
                label: ostatniaWystawiona ? `Kopiuj ostatnią (${ostatniaWystawiona.numer})` : 'Kopiuj ostatnią fakturę',
                icon: 'repeat',
                disabled: !ostatniaWystawiona,
                title: 'Nowa faktura z tym samym klientem i pozycjami, z bieżącą datą',
                onClick: () => ostatniaWystawiona && setModal({ mode: 'create', szablon: szablonKopii(ostatniaWystawiona) }),
              },
              { label: 'Eksport CSV (widoczne)', icon: 'download', disabled: filtered.length === 0, onClick: () => download(`faktury-${dzis}.csv`, sprzedazCsv(filtered), 'text/csv;charset=utf-8') },
              { label: 'Faktury cykliczne', icon: 'calendar', onClick: () => navigate('narzedzia') },
            ]}
          />
          <button className="btn" onClick={() => setModal({ mode: 'create' })}>
            <Icon name="plus" size={16} /> Nowa faktura
          </button>
        </div>
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 12px' }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Pills
              label="Filtr"
              value={filtr}
              onChange={setFiltr}
              options={[
                { id: 'all', label: 'Wszystkie' },
                { id: 'nieoplacone', label: `Do zapłaty${liczby.nieoplacone ? ` (${liczby.nieoplacone})` : ''}` },
                { id: 'po_terminie', label: `Po terminie${liczby.po_terminie ? ` (${liczby.po_terminie})` : ''}` },
                { id: 'robocze', label: `Robocze${liczby.robocze ? ` (${liczby.robocze})` : ''}` },
              ]}
            />
            <div className="search">
              <Icon name="search" size={16} />
              <input className="compact" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: numer, klient, NIP, pozycja…" />
            </div>
            <select aria-label="Miesiąc" className="compact" value={miesiac} onChange={(e) => setMiesiac(e.target.value)}>
              <option value="all">Wszystkie miesiące</option>
              {miesiace.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <Empty
            icon="invoice"
            title={sales.length === 0 ? 'Nie masz jeszcze faktur' : 'Brak faktur dla tych filtrów'}
            hint={sales.length === 0 ? 'Wystaw pierwszą fakturę — dane firmy i rachunek podstawią się z Ustawień.' : 'Zmień filtr lub wyczyść wyszukiwanie.'}
            action={sales.length === 0 ? <button className="btn" onClick={() => setModal({ mode: 'create' })}><Icon name="plus" size={16} /> Nowa faktura</button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Numer</th><th>Klient</th><th className="hide-sm">Wystawiona</th><th>Termin</th>
                  <th className="num">Brutto</th><th className="hide-sm">Status</th><th>Płatność</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const v = salesVat(s);
                  const obca = s.waluta && s.waluta !== 'PLN';
                  const overdue = czyNieoplacona(s) && s.terminPlatnosci < dzis;
                  return (
                    <tr key={s.id} className={`clickable${otwarta?.id === s.id ? ' selected' : ''}`} onClick={() => otworz(s.id)}>
                      <td>
                        <b>{s.numer}</b>
                        {s.rodzaj && s.rodzaj !== 'sprzedazy' && <span className="sub">{rodzajLabel(s.rodzaj)}{s.korygujeNumer ? ` do ${s.korygujeNumer}` : ''}</span>}
                      </td>
                      <td>
                        {s.kontrahent.nazwa}
                        <span className="sub">{s.kontrahent.nip ? `NIP ${s.kontrahent.nip}` : 'bez NIP'}</span>
                      </td>
                      <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{formatDataPL(s.dataWystawienia)}</td>
                      <td style={{ whiteSpace: 'nowrap' }} className={overdue ? 'overdue' : ''}>{formatDataPL(s.terminPlatnosci)}</td>
                      <td className="num">
                        <b>{obca ? `${v.brutto.toFixed(2)} ${s.waluta}` : fmtMoney(v.brutto)}</b>
                        <span className="sub">netto {obca ? v.netto.toFixed(2) : fmtMoney(v.netto)}</span>
                      </td>
                      <td className="hide-sm"><StatusBadge status={s.status} /></td>
                      <td>{stanPlatnosci(s, dzis)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>{filtered.length} {filtered.length === 1 ? 'faktura' : 'faktur'}</td>
                  <td className="num">{fmtMoney(sumaBrutto)}<span className="sub" style={{ fontWeight: 400 }}>netto {fmtMoney(sumaNetto)}</span></td>
                  <td colSpan={2} className="hide-sm" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {otwarta && (
        <InvoiceDrawer
          inv={otwarta}
          settings={settings}
          onClose={zamknij}
          onEdit={() => setModal({ mode: 'edit', inv: otwarta })}
          onDuplicate={() => setModal({ mode: 'create', szablon: szablonKopii(otwarta) })}
          onKorekta={() => setModal({ mode: 'create', szablon: szablonKorekty(otwarta, todayISO()) })}
          onDeleted={zamknij}
        />
      )}

      {modal && (
        <InvoiceModal
          key={modal.mode === 'edit' ? modal.inv.id : 'new'}
          initial={modal.mode === 'edit' ? modal.inv : undefined}
          szablon={modal.mode === 'create' ? modal.szablon : undefined}
          existing={sales}
          onClose={() => setModal(null)}
          onSaved={(id) => otworz(id)}
        />
      )}
    </>
  );
}

function InvoiceDrawer({
  inv,
  settings,
  onClose,
  onEdit,
  onDuplicate,
  onKorekta,
  onDeleted,
}: {
  inv: SalesInvoice;
  settings: TaxpayerSettings;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onKorekta: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const v = salesVat(inv);
  const pln = salesVatPln(inv);
  const obca = !!inv.waluta && inv.waluta !== 'PLN';
  const dzis = todayISO();
  const [ksefBusy, setKsefBusy] = useState(false);
  const sprzedawca = sprzedawcaZUstawien(settings);
  const braki = inv.rodzaj === 'proforma' ? [] : brakiArt106e(inv, sprzedawca);
  const rachunek = inv.rachunekBankowy || settings.firmaRachunek;
  const fmt = (n: number): string => (obca ? `${n.toFixed(2)} ${inv.waluta}` : fmtMoney(n));
  const doKsef = inv.status === 'wystawiona' && (inv.rodzaj ?? 'sprzedazy') !== 'proforma' && inv.rodzaj !== 'zaliczkowa';

  async function wyslijDoKsef(): Promise<void> {
    setKsefBusy(true);
    try {
      const w = await api.ksef.wyslij(inv.id);
      updateSale({ ...inv, status: 'w_ksef', ksefId: w.ksefNumber ?? w.fakturaRef ?? inv.ksefId });
      toast(w.ksefNumber ? `Wysłano do KSeF — nr ${w.ksefNumber}` : (w.info ?? 'Wysłano do KSeF'));
    } catch (e) {
      toast(e instanceof ApiError ? `KSeF (HTTP ${e.status}): ${e.message}` : `KSeF: ${e instanceof Error ? e.message : 'nieznany błąd'}`, 'err');
    } finally {
      setKsefBusy(false);
    }
  }

  async function podgladFa3(): Promise<void> {
    setKsefBusy(true);
    try {
      const p = await api.ksef.podglad(inv.id);
      download(`FA3-${inv.numer.replaceAll('/', '-')}.xml`, p.xml, 'application/xml');
      const w = p.walidacja;
      if (w.ok) toast(`Pobrano FA(3) — zgodny ze schematem MF (${p.formCode})`);
      else if (w.pominieta) toast(`Pobrano FA(3); walidacja XSD pominięta: ${w.bledy.slice(0, 2).join('; ')}`, 'info');
      else toast(`FA(3) niezgodny z XSD: ${w.bledy.slice(0, 3).join('; ')}`, 'err');
    } catch (e) {
      toast(e instanceof ApiError ? `Podgląd FA(3) (HTTP ${e.status}): ${e.message}` : `Podgląd FA(3): ${e instanceof Error ? e.message : 'błąd'}`, 'err');
    } finally {
      setKsefBusy(false);
    }
  }

  function drukuj(motyw: 'jasny' | 'ciemny' = 'jasny'): void {
    const html = fakturaHtml(inv, sprzedawca, { motyw });
    const w = window.open('', '_blank');
    if (!w) {
      download(`Faktura-${inv.numer.replaceAll('/', '-')}.html`, html, 'text/html;charset=utf-8');
      toast('Wyskakujące okna zablokowane — pobrano plik HTML do wydruku', 'info');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  return (
    <Drawer
      onClose={onClose}
      title={<>Faktura {inv.numer}</>}
      sub={
        <>
          <StatusBadge status={inv.status} />
          {stanPlatnosci(inv, dzis)}
          {inv.rodzaj && inv.rodzaj !== 'sprzedazy' && <Badge tone="blue">{rodzajLabel(inv.rodzaj)}</Badge>}
          {inv.mpp && <Badge tone="amber">MPP</Badge>}
        </>
      }
      foot={
        <>
          {inv.status === 'robocza' && (
            <>
              <button className="btn" onClick={() => { updateSale({ ...inv, status: 'wystawiona' }); toast(`Wystawiono fakturę ${inv.numer}`); }}>
                <Icon name="check" size={16} /> Wystaw
              </button>
              <button className="btn secondary" onClick={onEdit}><Icon name="edit" size={15} /> Edytuj</button>
            </>
          )}
          {doKsef && (
            <button className="btn" disabled={ksefBusy} onClick={() => void wyslijDoKsef()} title="Wyślij jako FA(3) do KSeF (token w Ustawieniach → Integracje)">
              <Icon name="upload" size={16} /> {ksefBusy ? 'Wysyłanie…' : 'Wyślij do KSeF'}
            </button>
          )}
          {inv.status !== 'robocza' && inv.rodzaj !== 'proforma' && (
            <button
              className={`btn ${inv.zaplacona ? 'secondary' : doKsef ? 'secondary' : ''}`}
              onClick={() => {
                updateSale({ ...inv, zaplacona: !inv.zaplacona });
                toast(inv.zaplacona ? 'Cofnięto opłacenie' : `Faktura ${inv.numer} opłacona`);
              }}
            >
              <Icon name={inv.zaplacona ? 'undo' : 'wallet'} size={15} /> {inv.zaplacona ? 'Cofnij opłacenie' : 'Opłacona'}
            </button>
          )}
          <button className="btn secondary" onClick={() => drukuj()} title="W oknie drukowania wybierz „Zapisz jako PDF”">
            <Icon name="printer" size={15} /> PDF
          </button>
          <a className="btn secondary" href={mailtoFaktury(inv, settings)} title={inv.kontrahent.email ? `Napisz do ${inv.kontrahent.email} — dołącz PDF` : 'Brak e-maila klienta — uzupełnisz w programie pocztowym'}>
            <Icon name="mail" size={15} /> E-mail
          </a>
          <span className="spacer" />
          <Menu
            up
            label=""
            items={[
              { label: 'Duplikuj jako nową', icon: 'copy', onClick: onDuplicate },
              { label: 'Wystaw korektę', icon: 'undo', disabled: inv.status === 'robocza' || inv.rodzaj === 'proforma', title: 'Faktura korygująca (art. 106j) do tej faktury', onClick: onKorekta },
              { label: 'Edytuj', icon: 'edit', disabled: inv.status !== 'robocza', title: inv.status !== 'robocza' ? 'Wystawionej faktury nie edytuje się — wystaw korektę' : undefined, onClick: onEdit, sep: true },
              { label: 'Pobierz FA(3) XML', icon: 'code', disabled: ksefBusy, onClick: () => void podgladFa3() },
              { label: 'Wydruk w wersji ciemnej', icon: 'printer', onClick: () => drukuj('ciemny') },
              { label: 'Kopiuj dane do przelewu', icon: 'copy', disabled: !rachunek, onClick: () => kopiuj(danePrzelewu(rachunek ?? '', v.brutto, inv.numer, settings.firmaNazwa ?? ''), 'Skopiowano dane przelewu') },
              { label: 'Oznacz sprawdzenie Białej Listy', icon: 'shield', sep: true, onClick: () => { updateSale({ ...inv, bialaListaSprawdzona: new Date().toISOString() }); toast('Zapisano sprawdzenie Białej Listy'); } },
              { label: 'Pobierz dowód Białej Listy (JSON)', icon: 'download', onClick: () => download(`Dowod-BL-${inv.numer.replaceAll('/', '-')}.json`, JSON.stringify(budujDowodBL(inv.kontrahent.nip, inv.numer, v.brutto, inv.rachunekBankowy, inv.mpp ? 'mpp' : 'biala-lista'), null, 2)) },
              {
                label: 'Usuń fakturę', icon: 'trash', danger: true, sep: true,
                onClick: () => {
                  const msg = inv.status === 'w_ksef'
                    ? `Faktura ${inv.numer} jest w KSeF — usunięcie z Franka NIE usuwa jej z KSeF. Usunąć lokalnie?`
                    : `Usunąć fakturę ${inv.numer}?`;
                  if (!window.confirm(msg)) return;
                  removeSale(inv.id);
                  toast(`Usunięto fakturę ${inv.numer}`);
                  onDeleted();
                },
              },
            ]}
          />
        </>
      }
    >
      {braki.length > 0 && inv.status === 'robocza' && (
        <div className="warn">
          <b>Brakuje pól wymaganych na fakturze (art. 106e):</b> {braki.join(', ')}.
          {braki.some((b) => b.includes('sprzedawcy')) && <> Uzupełnij w <a href="#/ustawienia/firma">Ustawieniach → Firma</a>.</>}
        </div>
      )}
      {inv.rodzaj === 'proforma' && <div className="info">Proforma to oferta — nie wchodzi do PIT, VAT ani KSeF.</div>}

      <div className="form-grid-2">
        <div>
          <div className="dl-title">Nabywca</div>
          <div><b>{inv.kontrahent.nazwa}</b></div>
          <div className="muted">{inv.kontrahent.nip ? `NIP ${inv.kontrahent.nip}` : 'bez NIP'}</div>
          {inv.kontrahent.adres && <div className="muted">{inv.kontrahent.adres}</div>}
          {inv.kontrahent.email && <div className="muted">{inv.kontrahent.email}</div>}
        </div>
        <div>
          <div className="dl-title">Daty</div>
          <dl className="dl">
            <dt>Wystawienia</dt><dd>{formatDataPL(inv.dataWystawienia)}</dd>
            <dt>Sprzedaży</dt><dd>{formatDataPL(inv.dataSprzedazy)}</dd>
            <dt>Termin płatności</dt><dd className={inv.terminPlatnosci < dzis && !inv.zaplacona && inv.status !== 'robocza' ? 'overdue' : ''}>{formatDataPL(inv.terminPlatnosci)}</dd>
          </dl>
        </div>
      </div>

      {inv.korygujeNumer && (
        <div className="info">Koryguje fakturę <b>{inv.korygujeNumer}</b>. Kwoty poniżej to różnica względem faktury pierwotnej.</div>
      )}

      <div>
        <div className="dl-title">Pozycje</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nazwa</th><th className="num">Ilość</th><th className="num">Cena netto</th><th className="num">VAT</th><th className="num">Netto</th></tr></thead>
            <tbody>
              {inv.pozycje.map((p, i) => (
                <tr key={i}>
                  <td>{p.nazwa}</td>
                  <td className="num">{p.ilosc}</td>
                  <td className="num">{fmt(p.cenaNetto)}</td>
                  <td className="num">{vatLabel(p.stawkaVat)}</td>
                  <td className="num">{fmt(p.ilosc * p.cenaNetto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 10 }}>
          <span className="t">Netto<b>{fmt(v.netto)}</b></span>
          <span className="t">VAT<b>{fmt(v.vat)}</b></span>
          <span className="t grand">Brutto<b>{fmt(v.brutto)}</b></span>
        </div>
        {obca && (
          <div className={brakKursu(inv) ? 'warn' : 'muted'} style={{ marginTop: 8 }}>
            {brakKursu(inv)
              ? `Brak kursu NBP — do PIT/VAT faktura liczy się jak w PLN. Uzupełnij kurs (edycja lub korekta).`
              : `Kurs NBP ${inv.kursNbp} → netto ${fmtMoney(pln.netto)}, VAT ${fmtMoney(pln.vat)} w PLN (do PIT i JPK).`}
          </div>
        )}
      </div>

      <div className="form-grid-2">
        <div>
          <div className="dl-title">Płatność</div>
          <dl className="dl">
            <dt>Forma</dt><dd>przelew{inv.mpp ? ' (MPP)' : ''}</dd>
            <dt>Rachunek</dt><dd className="mono">{rachunek || <span className="text-amber">brak — dodaj w Ustawieniach</span>}</dd>
            <dt>Biała Lista</dt><dd>{inv.bialaListaSprawdzona ? formatDataPL(inv.bialaListaSprawdzona) : 'nie sprawdzono'}</dd>
          </dl>
        </div>
        <div>
          <div className="dl-title">KSeF</div>
          <dl className="dl">
            <dt>Numer KSeF</dt><dd className="mono">{inv.ksefId ?? '—'}</dd>
            <dt>Tryb</dt><dd>{inv.trybKsef ?? 'online'}</dd>
          </dl>
        </div>
      </div>

      {pln.brutto > 15000 && !inv.mpp && (
        <div className="warn">
          Brutto powyżej 15 000 zł — rachunek na fakturze musi być na Białej Liście VAT, inaczej klient nie zaliczy
          wydatku w koszty (sprawdź na <a href="https://wl-api.mf.gov.pl" target="_blank" rel="noreferrer">wykazie MF</a>).
        </div>
      )}
    </Drawer>
  );
}

function blankItem(): InvoiceItem {
  return { nazwa: '', ilosc: 1, cenaNetto: 0, stawkaVat: 0.23 };
}

const TERMINY_DNI = [7, 14, 21, 30];

function InvoiceModal({
  initial,
  szablon,
  existing,
  onClose,
  onSaved,
}: {
  initial?: SalesInvoice;
  szablon?: Partial<SalesInvoice>;
  existing: SalesInvoice[];
  onClose: () => void;
  onSaved: (id: string) => void;
}): JSX.Element {
  const today = todayISO();
  const { contractors, settings } = useStore();
  const isRyczalt = settings.formaOpodatkowania === 'ryczalt';
  const src = initial ?? szablon;
  const domyslneDni = settings.terminPlatnosciDni && settings.terminPlatnosciDni > 0 ? settings.terminPlatnosciDni : 14;
  const domyslnaStawka: VatRate = settings.vatowiec ? 0.23 : 'zw';

  const [kontrahentId, setKontrahentId] = useState(src?.kontrahent?.id ?? '');
  const [dataWyst, setDataWyst] = useState(src?.dataWystawienia ?? today);
  const [numer, setNumer] = useState(initial?.numer ?? nastepnyNumer(existing, src?.dataWystawienia ?? today));
  const [numerReczny, setNumerReczny] = useState(!!initial);
  const [nazwa, setNazwa] = useState(src?.kontrahent?.nazwa ?? '');
  const [nip, setNip] = useState(src?.kontrahent?.nip ?? '');
  const [adres, setAdres] = useState(src?.kontrahent?.adres ?? '');
  const [email, setEmail] = useState(src?.kontrahent?.email ?? '');
  const [dataSprz, setDataSprz] = useState(src?.dataSprzedazy ?? today);
  const [terminDni, setTerminDni] = useState<number | null>(initial ? null : domyslneDni);
  const [terminRecznie, setTerminRecznie] = useState(initial?.terminPlatnosci ?? src?.terminPlatnosci ?? addDaysISO(today, domyslneDni));
  const termin = terminDni !== null ? addDaysISO(dataWyst, terminDni) : terminRecznie;
  const [items, setItems] = useState<InvoiceItem[]>(
    src?.pozycje ? structuredClone(src.pozycje) : [{ ...blankItem(), nazwa: `Usługi programistyczne ${today.slice(5, 7)}/${today.slice(0, 4)}`, stawkaVat: domyslnaStawka }],
  );
  const [waluta, setWaluta] = useState(src?.waluta ?? 'PLN');
  const [kursNbp, setKursNbp] = useState(src?.kursNbp !== undefined ? String(src.kursNbp) : '');
  const [kursInfo, setKursInfo] = useState('');
  const [kursLaduje, setKursLaduje] = useState(false);
  const [mpp, setMpp] = useState(src?.mpp ?? false);
  const [rachunek, setRachunek] = useState(src?.rachunekBankowy ?? '');
  const [bialaLista, setBialaLista] = useState(src?.bialaListaSprawdzona ?? '');
  const [rodzaj, setRodzaj] = useState<RodzajFaktury>(src?.rodzaj ?? 'sprzedazy');
  const [korygujeNumer, setKorygujeNumer] = useState(src?.korygujeNumer ?? '');
  const [zal15, setZal15] = useState(src?.zal15 ?? false);
  const [trybKsef, setTrybKsef] = useState<TrybKsef>(src?.trybKsef ?? 'online');
  const korekta = rodzaj === 'korygujaca';

  function zmienDateWyst(d: string): void {
    setDataWyst(d);
    if (!numerReczny && /^\d{4}-\d{2}-\d{2}$/.test(d)) setNumer(nastepnyNumer(existing, d));
  }

  /** Kurs 1-klik: średni NBP z dnia roboczego poprzedzającego sprzedaż (art. 31a). */
  function pobierzKursNbp(): void {
    setKursLaduje(true);
    setKursInfo('');
    void pobierzKurs(waluta, dzienPoprzedniRoboczy(dataSprz))
      .then((info) => {
        setKursNbp(String(info.kurs));
        setKursInfo(`tabela NBP z ${formatDataPL(info.data)}${info.zrodlo === 'fallback' ? ' (zapasowa — sprawdź!)' : ''}`);
      })
      .catch((e: unknown) => setKursInfo(e instanceof Error ? e.message : 'Brak kursu'))
      .finally(() => setKursLaduje(false));
  }

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

  // NIP: polski → same cyfry; zagraniczny (prefiks kraju) → bez spacji, wielkie litery
  const nipNorm = /^[A-Za-z]{2}/.test(nip.trim()) && !/^PL/i.test(nip.trim())
    ? nip.replace(/[\s-]/g, '').toUpperCase()
    : nip.replace(/\D/g, '');
  const obca = waluta !== 'PLN';

  const draft: SalesInvoice = {
    id: initial?.id ?? 'draft',
    numer,
    kontrahent: { id: kontrahentId || initial?.kontrahent.id || uid('k'), nazwa, nip: nipNorm, adres, email: email || undefined },
    dataWystawienia: dataWyst,
    dataSprzedazy: dataSprz,
    terminPlatnosci: termin,
    pozycje: items,
    status: initial?.status ?? 'robocza',
    zaplacona: initial?.zaplacona,
    waluta: obca ? waluta : undefined,
    kursNbp: obca && kursNbp.trim() !== '' ? Number(kursNbp) : undefined,
    mpp: mpp || undefined,
    rachunekBankowy: rachunek.trim() || undefined,
    bialaListaSprawdzona: bialaLista.trim() || undefined,
    rodzaj: rodzaj === 'sprzedazy' ? undefined : rodzaj,
    korygujeNumer: korekta ? korygujeNumer.trim() || undefined : undefined,
    zal15: zal15 || undefined,
    trybKsef: trybKsef === 'online' ? undefined : trybKsef,
    ksefId: initial?.ksefId,
  };
  const totals = salesVat(draft);
  const totalsPln = salesVatPln(draft);

  const plNip = /^\d+$/.test(nipNorm);
  const nipWarn = plNip && nipNorm.length > 0 && !isValidNip(nipNorm) ? 'Błędna suma kontrolna NIP.' : undefined;
  const duplikat = existing.some((s) => s.numer === numer.trim() && s.id !== initial?.id);
  const itemsValid = items.length > 0 && items.every((p) => p.nazwa.trim() && Number.isFinite(p.ilosc) && (korekta ? p.ilosc !== 0 : p.ilosc > 0) && p.cenaNetto >= 0);
  const bledy: string[] = [];
  if (!numer.trim()) bledy.push('numer');
  if (duplikat) bledy.push('numer już istnieje');
  if (!nazwa.trim()) bledy.push('nazwa nabywcy');
  if (!itemsValid) bledy.push(korekta ? 'pozycje (ilość ≠ 0)' : 'pozycje (ilość > 0)');
  if (dataSprz.length !== 10 || dataWyst.length !== 10) bledy.push('daty');
  if (korekta && !korygujeNumer.trim()) bledy.push('numer faktury korygowanej');
  if (obca && !(Number(kursNbp) > 0)) bledy.push(`kurs NBP ${waluta}`);
  const canSave = bledy.length === 0;

  function save(asIssued: boolean): void {
    if (!canSave) return;
    const inv: SalesInvoice = {
      ...draft,
      numer: numer.trim(),
      kontrahent: { ...draft.kontrahent, nazwa: nazwa.trim() },
      status: asIssued && (initial?.status ?? 'robocza') === 'robocza' ? 'wystawiona' : (initial?.status ?? 'robocza'),
    };
    const id = initial?.id ?? uid('fv');
    if (initial) updateSale({ ...inv, id });
    else addSale({ ...inv, id });
    toast(initial ? `Zapisano fakturę ${inv.numer}` : asIssued ? `Wystawiono fakturę ${inv.numer}` : `Zapisano roboczą ${inv.numer}`);
    onClose();
    onSaved(id);
  }

  function setItem(i: number, patch: Partial<InvoiceItem>): void {
    setItems((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  const tytul = initial ? `Edycja faktury ${initial.numer}` : korekta ? `Faktura korygująca${korygujeNumer ? ` do ${korygujeNumer}` : ''}` : 'Nowa faktura';
  const fmtW = (n: number): string => (obca ? `${n.toFixed(2)} ${waluta}` : fmtMoney(n));

  return (
    <Modal
      title={tytul}
      onClose={onClose}
      wide
      foot={
        <>
          {!canSave && <span className="field-error" style={{ marginRight: 'auto' }}>Uzupełnij: {bledy.join(', ')}</span>}
          <button className="btn secondary" onClick={onClose}>Anuluj</button>
          {(!initial || initial.status === 'robocza') && (
            <button className="btn secondary" disabled={!canSave} onClick={() => save(false)}>
              {initial ? 'Zapisz' : 'Zapisz roboczą'}
            </button>
          )}
          <button className="btn" disabled={!canSave} onClick={() => save(true)}>
            {initial && initial.status !== 'robocza' ? 'Zapisz' : 'Wystaw fakturę'}
          </button>
        </>
      }
    >
      <div className="form-section">
        <h4>Nabywca</h4>
        <div className="form-grid-2">
          {contractors.length > 0 && (
            <Field label="Z bazy kontrahentów">
              <select value={kontrahentId} onChange={(e) => pickContractor(e.target.value)}>
                <option value="">— nowy / wpisz ręcznie —</option>
                {contractors.map((k: ContractorFull) => (
                  <option key={k.id} value={k.id}>{k.nazwa}{k.nip ? ` (${k.nip})` : ''}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="NIP" error={nipWarn} hint={!plNip && nipNorm ? 'Kontrahent zagraniczny — numer VAT z prefiksem kraju' : 'Wpisz NIP i pobierz dane z rejestru'}>
            <input value={nip} onChange={(e) => setNip(e.target.value)} placeholder="10 cyfr lub np. DE123456789" />
          </Field>
        </div>
        <RegistrySearch nip={nip} onFill={fillFromRegistry} />
        <div className="form-grid-2">
          <Field label="Nazwa">
            <input value={nazwa} onChange={(e) => setNazwa(e.target.value)} placeholder="Acme Sp. z o.o." />
          </Field>
          <Field label="E-mail do wysyłki faktury">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faktury@klient.pl" />
          </Field>
          <Field label="Adres" className="span-row" >
            <input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="ul. Przykładowa 1, 00-001 Warszawa" />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <h4>Dokument</h4>
        <div className="form-grid-4">
          <Field label="Rodzaj">
            <select value={rodzaj} onChange={(e) => setRodzaj(e.target.value as RodzajFaktury)}>
              <option value="sprzedazy">{settings.vatowiec ? 'Faktura VAT' : 'Faktura'}</option>
              <option value="korygujaca">Korygująca</option>
              <option value="zaliczkowa">Zaliczkowa</option>
              <option value="proforma">Proforma</option>
              <option value="uproszczona">Uproszczona (do 450 zł)</option>
            </select>
          </Field>
          <Field label="Numer" error={duplikat ? 'Taki numer już istnieje' : undefined}>
            <input value={numer} onChange={(e) => { setNumer(e.target.value); setNumerReczny(true); }} />
          </Field>
          <Field label="Data wystawienia">
            <input type="date" value={dataWyst} onChange={(e) => zmienDateWyst(e.target.value)} />
          </Field>
          <Field label="Data sprzedaży">
            <input type="date" value={dataSprz} onChange={(e) => setDataSprz(e.target.value)} />
          </Field>
        </div>
        {korekta && (
          <div className="form-grid-2">
            <Field label="Koryguje fakturę nr" error={!korygujeNumer.trim() ? 'Wymagane' : undefined}>
              <input value={korygujeNumer} onChange={(e) => setKorygujeNumer(e.target.value)} placeholder="np. 1/10/2026" list="faktury-numery" />
              <datalist id="faktury-numery">
                {existing.filter((s) => s.rodzaj !== 'proforma' && s.status !== 'robocza').map((s) => <option key={s.id} value={s.numer} />)}
              </datalist>
            </Field>
            <div className="info" style={{ alignSelf: 'end' }}>
              Wpisz <b>różnicę</b>: ujemna ilość zmniejsza, dodatnia zwiększa. Domyślnie korekta zeruje całą fakturę.
            </div>
          </div>
        )}
        {rodzaj === 'uproszczona' && totals.brutto > 450 && <div className="warn">Uproszczona powyżej 450 zł brutto — wystaw zwykłą fakturę.</div>}
        {rodzaj === 'proforma' && <div className="info">Proforma nie wejdzie do PIT, VAT ani KSeF — po akceptacji wystaw fakturę.</div>}
      </div>

      <div className="form-section">
        <h4>Pozycje</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Nazwa</th><th className="num">Ilość</th><th className="num">Cena netto{obca ? ` (${waluta})` : ''}</th><th>VAT</th>
                {isRyczalt && <th>Ryczałt</th>}
                <th className="num">Wartość</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={i}>
                  <td><input value={p.nazwa} onChange={(e) => setItem(i, { nazwa: e.target.value })} placeholder="Usługa…" /></td>
                  <td><input type="number" step="any" value={p.ilosc} onChange={(e) => setItem(i, { ilosc: Number(e.target.value) })} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td><input type="number" min={0} step="any" value={p.cenaNetto} onChange={(e) => setItem(i, { cenaNetto: Number(e.target.value) })} style={{ width: 120, textAlign: 'right' }} /></td>
                  <td>
                    <select
                      value={String(p.stawkaVat)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v: VatRate = raw === 'zw' || raw === 'np' || raw === 'oo' ? raw : (Number(raw) as VatRate);
                        setItem(i, { stawkaVat: v });
                      }}
                      style={{ width: 82 }}
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
                        style={{ width: 120 }}
                        title="Stawka ryczałtu dla pozycji (pusta = domyślna z ustawień)"
                      >
                        <option value="">domyślna ({(settings.stawkaRyczaltu * 100).toFixed(settings.stawkaRyczaltu < 0.1 ? 1 : 0)}%)</option>
                        {RYCZALT.map((o) => (
                          <option key={o.stawka} value={String(o.stawka)}>{(o.stawka * 100).toFixed(o.stawka < 0.1 ? 1 : 0)}% — {o.tytul}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="num">{fmtW(p.ilosc * p.cenaNetto)}</td>
                  <td>
                    <button className="btn ghost small icon-only" aria-label="Usuń pozycję" disabled={items.length <= 1} onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>
                      <Icon name="x" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button className="btn secondary small" onClick={() => setItems((prev) => [...prev, { ...blankItem(), stawkaVat: domyslnaStawka }])}>
            <Icon name="plus" size={15} /> Dodaj pozycję
          </button>
          <div className="totals">
            <span className="t">Netto<b>{fmtW(totals.netto)}</b></span>
            <span className="t">VAT<b>{fmtW(totals.vat)}</b></span>
            <span className="t grand">Do zapłaty<b>{fmtW(totals.brutto)}</b></span>
          </div>
        </div>
        {obca && Number(kursNbp) > 0 && (
          <div className="muted">W PLN (kurs {kursNbp}): netto {fmtMoney(totalsPln.netto)}, VAT {fmtMoney(totalsPln.vat)} — te kwoty idą do PIT i JPK.</div>
        )}
      </div>

      <div className="form-section">
        <h4>Płatność</h4>
        <div className="form-grid-2">
          <Field label="Termin płatności">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pills
                label="Termin w dniach"
                value={terminDni === null ? 'data' : String(terminDni)}
                onChange={(v) => {
                  if (v === 'data') {
                    setTerminRecznie(termin);
                    setTerminDni(null);
                  } else setTerminDni(Number(v));
                }}
                options={[...TERMINY_DNI.map((d) => ({ id: String(d), label: `${d} dni` })), { id: 'data', label: 'data' }]}
              />
              {terminDni === null
                ? <input type="date" className="compact" value={terminRecznie} onChange={(e) => setTerminRecznie(e.target.value)} style={{ width: 160 }} />
                : <span className="muted">{formatDataPL(termin)}</span>}
            </div>
          </Field>
          <Field label="Rachunek bankowy" hint={!rachunek && settings.firmaRachunek ? `Domyślny z Ustawień: ${settings.firmaRachunek}` : !settings.firmaRachunek ? 'Dodaj domyślny rachunek w Ustawieniach → Firma' : undefined}>
            <input value={rachunek} onChange={(e) => setRachunek(e.target.value)} placeholder={settings.firmaRachunek || 'PL 00 0000 0000 …'} />
          </Field>
          <Field label="Waluta">
            <select value={waluta} onChange={(e) => setWaluta(e.target.value)}>
              {['PLN', 'EUR', 'USD', 'GBP', 'CHF'].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </Field>
          {obca && (
            <Field label={`Kurs NBP ${waluta}/PLN`} hint={kursInfo || `Średni kurs z ostatniego dnia roboczego przed ${formatDataPL(dataSprz)} (art. 31a)`}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={0} step="any" value={kursNbp} onChange={(e) => setKursNbp(e.target.value)} placeholder="np. 4,2512" />
                <button className="btn secondary" onClick={pobierzKursNbp} disabled={kursLaduje} title={`Kurs z ${dzienPoprzedniRoboczy(dataSprz)}`}>
                  {kursLaduje ? 'Pobieram…' : 'Pobierz z NBP'}
                </button>
              </div>
            </Field>
          )}
        </div>
      </div>

      <details className="more" open={mpp || zal15 || trybKsef !== 'online' || !!bialaLista}>
        <summary><Icon name="chevronRight" size={15} /> Opcje dodatkowe — MPP, KSeF offline, Biała Lista</summary>
        <div className="form-section">
          <label className="inline">
            <input type="checkbox" checked={zal15} onChange={(e) => setZal15(e.target.checked)} />
            Towar/usługa z załącznika 15 (elektronika, paliwa, stal…) — powyżej 15 000 zł obowiązkowy MPP
          </label>
          <label className="inline">
            <input type="checkbox" checked={mpp} onChange={(e) => setMpp(e.target.checked)} />
            Adnotacja „mechanizm podzielonej płatności”
          </label>
          {zal15 && totalsPln.brutto > 15000 && !mpp && <div className="warn">Załącznik 15 i brutto powyżej 15 000 zł — zaznacz MPP.</div>}
          <div className="form-grid-2">
            <Field label="Tryb wystawienia w KSeF" hint="Offline24 / awaria: faktura poza KSeF, wysyłka później.">
              <select value={trybKsef} onChange={(e) => setTrybKsef(e.target.value as TrybKsef)}>
                <option value="online">Online</option>
                <option value="offline24">Offline24 (wyślij w ciągu 24 h)</option>
                <option value="awaria">Awaria KSeF</option>
              </select>
            </Field>
            <Field label="Sprawdzenie Białej Listy" hint="Data sprawdzenia rachunku nabywcy/dostawcy.">
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={bialaLista} onChange={(e) => setBialaLista(e.target.value)} placeholder="nie sprawdzono" />
                <button className="btn secondary" onClick={() => setBialaLista(new Date().toISOString())}>Teraz</button>
              </div>
            </Field>
          </div>
        </div>
      </details>
    </Modal>
  );
}
