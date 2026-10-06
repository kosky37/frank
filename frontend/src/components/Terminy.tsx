import { useMemo, useState, type JSX } from 'react';
import { buildIcs } from '../lib/batchE.js';
import { terminyCsv } from '../lib/quickwins.js';
import { addDaysISO, fmtMoney, formatDataPL, todayISO } from '../lib/format.js';
import { dostepneLata, ustawRok, useRok, useStore } from '../lib/store.js';
import { przelewTekst, przelewZobowiazania, useRozliczenie, useZobowiazania, type ZobowiazanieUI } from '../lib/rozliczenie.js';
import { MIESIACE, przelaczTermin, terminyRoku, useOdhaczone, type Termin } from '../lib/terminy.js';
import { dniPoTerminie } from '../lib/quickwins.js';
import { zobowiazaniaRoku } from '../../src-shared/tax/rok.js';
import { Empty, Icon, kopiuj, Menu, Pills, toast, type IconName } from './ui.js';

export { dzienRoboczy } from '../lib/terminy.js';
export type { Termin } from '../lib/terminy.js';

const IKONA: Record<Termin['rodzaj'], IconName> = {
  pit: 'calculator', zus: 'shield', vat: 'receipt', roczny: 'file', info: 'info',
};

const NAZWA: Record<ZobowiazanieUI['rodzaj'], string> = { pit: 'Zaliczka PIT', zus: 'ZUS', vat: 'VAT' };

function okresLabel(okres: string): string {
  const q = /^(\d{4})-Q(\d)$/.exec(okres);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = Number(okres.slice(5, 7));
  return `${MIESIACE[m - 1]?.toLowerCase() ?? okres} ${okres.slice(0, 4)}`;
}

function kiedy(termin: string, dzis: string): { tekst: string; tone: 'red' | 'amber' | 'gray' } {
  if (termin < dzis) return { tekst: `${dniPoTerminie(termin, dzis)} d po terminie`, tone: 'red' };
  const dni = dniPoTerminie(dzis, termin);
  if (dni === 0) return { tekst: 'dziś', tone: 'red' };
  if (dni <= 7) return { tekst: `za ${dni} d`, tone: 'amber' };
  return { tekst: `za ${dni} d`, tone: 'gray' };
}

/** Wiersz zobowiązania z kwotą: odhacz, skopiuj dane przelewu. */
export function ZobowiazanieRow({ z, done }: { z: ZobowiazanieUI; done: boolean }): JSX.Element {
  const { settings } = useStore();
  const dzis = todayISO();
  const k = kiedy(z.terminRoboczy, dzis);
  const przelew = przelewZobowiazania(z, settings);
  return (
    <div className={`list-row${done ? ' done' : ''}`}>
      <div className={`chip-icon ${z.rodzaj}`}><Icon name={IKONA[z.rodzaj]} size={16} /></div>
      <div className="main">
        <b>{NAZWA[z.rodzaj]} za {okresLabel(z.okres)}</b>
        <small>
          do {formatDataPL(z.terminRoboczy)}
          {!done && <> • <span className={k.tone === 'red' ? 'text-red' : k.tone === 'amber' ? 'text-amber' : ''}>{k.tekst}</span></>}
          {done && ' • zapłacone'}
        </small>
      </div>
      <span className="amt">{fmtMoney(z.kwota)}</span>
      <div className="btn-group">
        <button
          className="btn ghost small icon-only"
          title={przelew ? 'Kopiuj dane przelewu' : z.rodzaj === 'zus' ? 'Uzupełnij NRS w Ustawieniach' : 'Uzupełnij poprawny NIP firmy w Ustawieniach'}
          aria-label="Kopiuj dane przelewu"
          disabled={!przelew || z.kwota <= 0}
          onClick={() => przelew && kopiuj(przelewTekst(przelew), `Skopiowano przelew: ${przelew.tytul}`)}
        >
          <Icon name="copy" size={16} />
        </button>
        <button
          className={`btn small ${done ? 'ghost' : 'secondary'}`}
          onClick={() => {
            przelaczTermin(z.id);
            if (!done) toast(`${NAZWA[z.rodzaj]} za ${okresLabel(z.okres)} oznaczone jako zapłacone`);
          }}
        >
          <Icon name={done ? 'undo' : 'check'} size={15} />
          {done ? 'Cofnij' : 'Zapłacone'}
        </button>
      </div>
    </div>
  );
}

/** Lista płatności do zrobienia: zaległe nieodhaczone + najbliższe (do `dni` dni). */
export function NajblizszePlatnosci({ dni = 35, pusto }: { dni?: number; pusto?: string }): JSX.Element {
  const zob = useZobowiazania();
  const odh = useOdhaczone();
  const dzis = todayISO();
  const granica = addDaysISO(dzis, dni);
  const lista = zob
    .filter((z) => z.kwota > 0 && z.terminRoboczy <= granica && (!odh[z.id] ? z.terminRoboczy >= addDaysISO(dzis, -120) : z.terminRoboczy >= dzis))
    .sort((a, b) => a.terminRoboczy.localeCompare(b.terminRoboczy) || a.rodzaj.localeCompare(b.rodzaj));
  if (lista.length === 0) {
    return <div className="muted" style={{ padding: '8px 0' }}>{pusto ?? 'Brak płatności w najbliższym czasie.'}</div>;
  }
  return (
    <div className="list">
      {lista.map((z) => <ZobowiazanieRow key={z.id} z={z} done={!!odh[z.id]} />)}
    </div>
  );
}

type Widok = 'platnosci' | 'kalendarz';

export function TerminyPage(): JSX.Element {
  const store = useStore();
  const { settings } = store;
  const rok = useRok();
  const lata = dostepneLata(store);
  if (!lata.includes(rok)) lata.unshift(rok);
  const odh = useOdhaczone();
  const dzis = todayISO();
  const [widok, setWidok] = useState<Widok>('platnosci');
  const r = useRozliczenie(rok);
  const zob = useMemo(() => zobowiazaniaRoku(r), [r]);
  const kwoty = useMemo(() => new Map(zob.map((z) => [z.id, z])), [zob]);
  const wszystkie = useMemo(() => terminyRoku(rok, settings).map((t) => {
    const z = kwoty.get(t.id);
    return z ? { ...t, kwota: z.kwota, okres: z.okres } : t;
  }), [rok, settings, kwoty]);
  const zobUI = useZobowiazania().filter((z) => z.termin.startsWith(`${rok}-`) || z.okres.startsWith(`${rok}-`));
  const doZaplaty = zobUI.filter((z) => z.kwota > 0 && !odh[z.id]);
  const sumaZalegle = doZaplaty.filter((z) => z.terminRoboczy < dzis).reduce((a, z) => a + z.kwota, 0);
  const zaplacone = zobUI.filter((z) => odh[z.id]).reduce((a, z) => a + z.kwota, 0);

  const miesiaceKal = useMemo(() => {
    const m: { nazwa: string; terminy: Termin[] }[] = MIESIACE.map((nazwa) => ({ nazwa, terminy: [] }));
    for (const t of wszystkie) {
      const mi = Number(t.data.slice(5, 7));
      if (t.data.startsWith(String(rok)) && mi >= 1 && mi <= 12) m[mi - 1].terminy.push(t);
    }
    return m;
  }, [wszystkie, rok]);

  function pobierz(nazwa: string, typ: string, tresc: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tresc], { type: typ }));
    a.download = nazwa;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Terminy i płatności</h2>
          <p>
            Kwoty z rozliczenia {rok} • terminy przesunięte z weekendów i świąt na najbliższy dzień roboczy
          </p>
        </div>
        <div className="page-actions">
          <select aria-label="Rok" className="compact" value={rok} onChange={(e) => ustawRok(Number(e.target.value))}>
            {lata.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <Menu
            label="Eksport"
            icon="download"
            small={false}
            items={[
              { label: 'Kalendarz (iCal)', icon: 'calendar', onClick: () => pobierz(`frank-terminy-${rok}.ics`, 'text/calendar;charset=utf-8', buildIcs(wszystkie, rok)) },
              { label: 'Arkusz (CSV)', icon: 'file', onClick: () => pobierz(`frank-terminy-${rok}.csv`, 'text/csv;charset=utf-8', terminyCsv(wszystkie)) },
            ]}
          />
        </div>
      </div>

      <div className="kpi-grid">
        <div className={`kpi-card ${sumaZalegle > 0 ? 'red' : 'green'}`}>
          <div className="kpi-label">Zaległe (nieodhaczone)</div>
          <div className="kpi-value">{fmtMoney(sumaZalegle)}</div>
          <div className="kpi-sub">{sumaZalegle > 0 ? 'odhacz zapłacone albo zapłać z odsetkami' : 'wszystko na bieżąco'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">PIT + ZUS + VAT {rok}</div>
          <div className="kpi-value">{fmtMoney(r.pitZaliczki + r.zusRazem + r.vatDoZaplaty)}</div>
          <div className="kpi-sub">PIT {fmtMoney(r.pitZaliczki)} • ZUS {fmtMoney(r.zusRazem)} • VAT {fmtMoney(r.vatDoZaplaty)}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Oznaczone jako zapłacone</div>
          <div className="kpi-value">{fmtMoney(zaplacone)}</div>
          <div className="kpi-sub">{zobUI.filter((z) => odh[z.id]).length} z {zobUI.filter((z) => z.kwota > 0).length} płatności</div>
        </div>
      </div>

      <Pills
        label="Widok"
        value={widok}
        onChange={setWidok}
        options={[{ id: 'platnosci', label: 'Płatności' }, { id: 'kalendarz', label: 'Kalendarz roku' }]}
      />
      <div style={{ height: 14 }} />

      {widok === 'platnosci' && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Płatności {rok}</h3>
              <p>Każda kwota wynika z dokumentów w danym okresie. Dane do przelewu kopiujesz ikoną obok kwoty.</p>
            </div>
          </div>
          {zobUI.length === 0 ? (
            <Empty icon="calendar" title="Brak okresów do rozliczenia" hint={`Rok ${rok} nie ma jeszcze miesięcy do rozliczenia.`} />
          ) : (
            <div className="list">
              {[...zobUI]
                .sort((a, b) => b.terminRoboczy.localeCompare(a.terminRoboczy) || a.rodzaj.localeCompare(b.rodzaj))
                .map((z) => <ZobowiazanieRow key={z.id} z={z} done={!!odh[z.id]} />)}
            </div>
          )}
          {(!settings.zusNrs || !settings.firmaNip) && (
            <div className="info" style={{ marginTop: 12 }}>
              Uzupełnij {!settings.firmaNip ? 'NIP firmy (mikrorachunek PIT/VAT)' : ''}{!settings.firmaNip && !settings.zusNrs ? ' i ' : ''}
              {!settings.zusNrs ? 'numer rachunku składkowego ZUS (NRS)' : ''} w <a href="#/ustawienia/firma">Ustawieniach</a>, żeby kopiować gotowe przelewy.
            </div>
          )}
        </div>
      )}

      {widok === 'kalendarz' && (
        <div className="card">
          <div className="card-head">
            <h3>Kalendarz {rok}</h3>
            <span className="muted">zaznacz, gdy zapłacone lub wysłane</span>
          </div>
          <div className="cal">
            {miesiaceKal.map((m, i) => {
              const ym = `${rok}-${String(i + 1).padStart(2, '0')}`;
              return (
                <div key={m.nazwa} className={`cal-month${dzis.startsWith(ym) ? ' current' : ''}`}>
                  <b>{m.nazwa}</b>
                  {m.terminy.length === 0 && <div className="muted">—</div>}
                  {m.terminy.map((t) => (
                    <label key={t.id} className={`cal-item${odh[t.id] ? ' done' : ''}${t.data < dzis ? ' past' : ''}`}>
                      <input type="checkbox" checked={!!odh[t.id]} onChange={() => przelaczTermin(t.id)} aria-label={`${t.tytul} ${formatDataPL(t.data)}`} />
                      <span className="d">{formatDataPL(t.data).slice(0, 5)}</span>
                      <span className="t" title={t.opis}>
                        {t.tytul}
                        {t.kwota !== undefined && t.kwota > 0 && <> — <b>{fmtMoney(t.kwota)}</b></>}
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            ZUS i zaliczka PIT — do 20., VAT — do 25. miesiąca po okresie
            {settings.zaliczkaPit === 'kwartalna' || settings.okresVat === 'kwartalny' ? ' (rozliczenia kwartalne: po kwartale)' : ''}.
            PIT roczny: 15 lutego – 30 kwietnia. Termin w sobotę, niedzielę lub święto przechodzi na następny dzień roboczy.
          </p>
        </div>
      )}
    </>
  );
}
