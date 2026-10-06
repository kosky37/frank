import { useMemo, useState, type JSX } from 'react';
import {
  addContractor,
  removeContractor,
  updateContractor,
  uid,
  useStore,
} from '../lib/store.js';
import { api, type ContractorFull, type GusWynik, type RegistrySubject } from '../lib/api.js';
import { ApiError } from '../lib/api.js';
import { isValidNip } from '../lib/format.js';
import { Badge, ConfirmButton, Empty, Field, Modal } from './ui.js';

// Eksportowane do użycia w fakturach (uzupełnianie kontrahenta) i w profilu firmy.
export type RegistryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; subject: RegistrySubject }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string };

export function RegistrySearch({
  nip,
  onFill,
}: {
  nip: string;
  onFill: (s: RegistrySubject) => void;
}): JSX.Element {
  const [state, setState] = useState<RegistryState>({ kind: 'idle' });
  const [gus, setGus] = useState<GusWynik | null>(null);
  const [gusInfo, setGusInfo] = useState('');
  const [gusLaduje, setGusLaduje] = useState(false);
  const digits = nip.replace(/\D/g, '');

  async function szukajGus(): Promise<void> {
    setGusLaduje(true);
    setGusInfo('');
    setGus(null);
    try {
      const w = await api.gusLookup(digits);
      setGus(w);
    } catch (e) {
      setGusInfo(e instanceof ApiError && e.status === 400
        ? 'GUS: uzupełnij klucz API BIR w Ustawieniach → Integracje (darmowy na api.stat.gov.pl).'
        : 'GUS BIR niedostępny — spróbuj później.');
    } finally {
      setGusLaduje(false);
    }
  }

  async function szukaj(): Promise<void> {
    if (digits.length !== 10) {
      setState({ kind: 'error', message: 'NIP musi mieć 10 cyfr.' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const subject = await api.registryLookup(digits);
      setState({ kind: 'found', subject });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ kind: 'notfound' });
      else if (e instanceof ApiError && e.status === 400)
        setState({ kind: 'error', message: 'Nieprawidłowy NIP.' });
      else setState({ kind: 'error', message: 'Rejestry niedostępne (limit MF lub brak sieci). Spróbuj później.' });
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <button className="btn secondary small" disabled={state.kind === 'loading'} onClick={szukaj}>
          {state.kind === 'loading' ? 'Szukam…' : 'Szukaj w rejestrach'}
        </button>
        <button className="btn ghost small" disabled={gusLaduje || digits.length < 9} onClick={() => void szukajGus()} title="Wyszukiwarka REGON (wymaga klucza BIR)">
          {gusLaduje ? 'GUS…' : 'Sprawdź GUS'}
        </button>
        <span className="muted">Biała Lista VAT{state.kind === 'found' && state.subject.zrodla.includes('krs') ? ' + KRS' : ''}</span>
      </div>
      {gus && (
        <div className="info" style={{ marginTop: 8 }}>
          <div><b>{gus.nazwa}</b> <span className="muted">(GUS REGON)</span></div>
          <div className="muted">NIP {gus.nip}{gus.regon ? ` • REGON ${gus.regon}` : ''}</div>
          <div className="muted">{gus.adres}</div>
          <div style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => onFill({ nazwa: gus.nazwa, nip: gus.nip, regon: gus.regon ?? undefined, krs: undefined, adres: gus.adres, email: undefined, statusVat: '', pkd: [], zrodla: ['gus'] })}>
              Uzupełnij dane
            </button>
          </div>
        </div>
      )}
      {gusInfo && <div className="warn" style={{ marginTop: 8 }}>{gusInfo}</div>}
      {state.kind === 'found' && (
        <div className="info" style={{ marginTop: 8 }}>
          <div><b>{state.subject.nazwa}</b></div>
          <div className="muted">
            NIP {state.subject.nip}
            {state.subject.regon && ` • REGON ${state.subject.regon}`}
            {state.subject.krs && ` • KRS ${state.subject.krs}`}
          </div>
          <div className="muted">{state.subject.adres}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <VatStatusBadge status={state.subject.statusVat} />
            {state.subject.pkd.slice(0, 4).map((p) => (
              <Badge key={p} tone="blue">PKD {p}</Badge>
            ))}
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => onFill(state.subject)}>
              Uzupełnij dane
            </button>
          </div>
        </div>
      )}
      {state.kind === 'notfound' && (
        <div className="warn" style={{ marginTop: 8 }}>
          Nie znaleziono podmiotu w Białej Liście VAT (osoba niebędąca czynnym podatnikiem lub zły NIP).
        </div>
      )}
      {state.kind === 'error' && (
        <div className="warn" style={{ marginTop: 8 }}>{state.message}</div>
      )}
    </div>
  );
}

export function VatStatusBadge({ status }: { status: string }): JSX.Element {
  const s = status.toLowerCase();
  if (s.includes('czynny')) return <Badge tone="green">VAT czynny</Badge>;
  if (s.includes('zwolniony')) return <Badge tone="amber">VAT zwolniony</Badge>;
  if (s.includes('niezarejestrowany')) return <Badge tone="gray">niezarejestrowany VAT</Badge>;
  if (s.includes('wykreśl') || s.includes('wykresl')) return <Badge tone="red">wykreślony z VAT</Badge>;
  return <Badge>{status || '—'}</Badge>;
}

function csvCell(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

function exportContractorsCsv(contractors: ContractorFull[]): void {
  const head = 'nazwa;nip;regon;adres;email;telefon';
  const lines = contractors.map((c) =>
    [c.nazwa, c.nip, c.regon ?? '', c.adres, c.email ?? '', c.telefon ?? '']
      .map(csvCell)
      .join(';'),
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([[head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }),
  );
  a.download = 'kontrahenci.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ContractorsTab(): JSX.Element {
  const { contractors, sales } = useStore();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; c: ContractorFull } | null>(null);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) {
      const key = s.kontrahent.id || s.kontrahent.nip;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [sales]);

  const brakujacyZfaktur = useMemo(() => {
    const znani = new Set(contractors.map((c) => c.nip.replace(/\D/g, '')).filter(Boolean));
    const mapa = new Map<string, { nazwa: string; nip: string; adres: string; email?: string }>();
    for (const s of sales) {
      const nip = (s.kontrahent.nip ?? '').replace(/\D/g, '');
      if (!nip || znani.has(nip) || mapa.has(nip)) continue;
      mapa.set(nip, {
        nazwa: s.kontrahent.nazwa,
        nip,
        adres: s.kontrahent.adres ?? '',
        email: s.kontrahent.email,
      });
    }
    return [...mapa.values()];
  }, [contractors, sales]);

  function importujZfaktur(): void {
    for (const k of brakujacyZfaktur) {
      addContractor({
        id: uid('kontrahent'),
        nazwa: k.nazwa || `Kontrahent ${k.nip}`,
        nip: k.nip,
        adres: k.adres || '',
        email: k.email,
        zrodlo: 'faktury',
      });
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contractors
      .filter((c) =>
        needle
          ? [c.nazwa, c.nip, c.regon ?? '', c.adres].some((v) => v.toLowerCase().includes(needle))
          : true,
      )
      .sort((a, b) => a.nazwa.localeCompare(b.nazwa));
  }, [contractors, q]);

  function invoicesOf(c: ContractorFull): number {
    return (usage.get(c.id) ?? 0) + (usage.get(c.nip.replace(/\D/g, '')) ?? 0);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Kontrahenci</h2>
          <p>{filtered.length} z {contractors.length} • dane z faktur + rejestrów (Biała Lista VAT, KRS)</p>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={() => exportContractorsCsv(contractors)}>
            Eksport CSV
          </button>
          {brakujacyZfaktur.length > 0 && (
            <button className="btn secondary" onClick={importujZfaktur} title="Dodaj kontrahentów występujących na fakturach, których nie ma w bazie">
              Importuj z faktur ({brakujacyZfaktur.length})
            </button>
          )}
          <button className="btn" onClick={() => setModal({ mode: 'create' })}>
            + Nowy kontrahent
          </button>
        </div>
      </div>
      {brakujacyZfaktur.length > 0 && contractors.length === 0 && (
        <div className="info" style={{ marginBottom: 12 }}>
          Na fakturach jest {brakujacyZfaktur.length} kontrahent(ów) spoza bazy
          ({brakujacyZfaktur.map((k) => k.nazwa).join(', ')}). Kliknij „Importuj z faktur”.
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: nazwa, NIP, REGON…" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <Empty
            title={contractors.length === 0 ? 'Brak kontrahentów' : 'Brak wyników'}
            hint="Dodaj kontrahenta ręcznie albo wyszukaj po NIP w rejestrach."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nazwa</th><th>NIP</th><th>REGON</th><th>Adres</th><th className="num">Faktury</th><th>Źródło</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.nazwa}</b>{c.email && <div className="muted">{c.email}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.nip}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.regon || '—'}</td>
                    <td>{c.adres}</td>
                    <td className="num">{invoicesOf(c)}</td>
                    <td>
                      {c.zrodlo === 'biala-lista' || c.zrodlo === 'krs' ? (
                        <Badge tone="green">rejestry</Badge>
                      ) : c.zrodlo === 'faktury' ? (
                        <Badge tone="blue">z faktur</Badge>
                      ) : (
                        <Badge>ręcznie</Badge>
                      )}
                    </td>
                    <td className="actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn secondary small" onClick={() => setModal({ mode: 'edit', c })}>
                        Edytuj
                      </button>
                      <ConfirmButton onConfirm={() => removeContractor(c.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal && (
        <ContractorModal
          key={modal.mode === 'edit' ? modal.c.id : 'new'}
          initial={modal.mode === 'edit' ? modal.c : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function ContractorModal({
  initial,
  onClose,
}: {
  initial?: ContractorFull;
  onClose: () => void;
}): JSX.Element {
  const [nazwa, setNazwa] = useState(initial?.nazwa ?? '');
  const [nip, setNip] = useState(initial?.nip ?? '');
  const [regon, setRegon] = useState(initial?.regon ?? '');
  const [adres, setAdres] = useState(initial?.adres ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [telefon, setTelefon] = useState(initial?.telefon ?? '');
  const [notatki, setNotatki] = useState(initial?.notatki ?? '');

  const nipDigits = nip.replace(/\D/g, '');
  const nipWarn = nipDigits.length > 0 && !isValidNip(nipDigits) ? 'NIP wygląda na nieprawidłowy.' : undefined;
  const canSave = nazwa.trim().length > 0 && nipDigits.length === 10;

  function fill(s: RegistrySubject): void {
    setNazwa(s.nazwa);
    setNip(s.nip);
    if (s.regon) setRegon(s.regon);
    if (s.adres) setAdres(s.adres);
    if (s.email) setEmail(s.email);
  }

  function save(): void {
    if (!canSave) return;
    const c: ContractorFull = {
      id: initial?.id ?? uid('kontrahent'),
      nazwa: nazwa.trim(),
      nip: nipDigits,
      regon: regon.trim() || undefined,
      adres: adres.trim(),
      email: email.trim() || undefined,
      telefon: telefon.trim() || undefined,
      notatki: notatki.trim() || undefined,
      zrodlo: initial?.zrodlo ?? 'recznie',
    };
    if (initial) updateContractor(c);
    else addContractor(c);
    onClose();
  }

  return (
    <Modal
      title={initial ? `Edytuj: ${initial.nazwa}` : 'Nowy kontrahent'}
      onClose={onClose}
      foot={
        <>
          <button className="btn secondary" onClick={onClose}>Anuluj</button>
          <button className="btn" disabled={!canSave} onClick={save}>
            {initial ? 'Zapisz' : 'Dodaj kontrahenta'}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="NIP" error={nipWarn}>
          <input value={nip} onChange={(e) => setNip(e.target.value)} placeholder="10 cyfr" inputMode="numeric" />
        </Field>
        <Field label="Nazwa">
          <input value={nazwa} onChange={(e) => setNazwa(e.target.value)} placeholder="Acme Sp. z o.o." />
        </Field>
      </div>
      <RegistrySearch nip={nip} onFill={fill} />
      <div className="row" style={{ marginTop: 12 }}>
        <Field label="REGON (opcjonalnie)">
          <input value={regon} onChange={(e) => setRegon(e.target.value)} placeholder="9 lub 14 cyfr" inputMode="numeric" />
        </Field>
        <Field label="Telefon (opcjonalnie)">
          <input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+48 …" />
        </Field>
      </div>
      <Field label="Adres">
        <input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="ulica, kod, miasto" />
      </Field>
      <Field label="E-mail (opcjonalnie)">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="fv@klient.pl" />
      </Field>
      <Field label="Notatki (opcjonalnie)">
        <input value={notatki} onChange={(e) => setNotatki(e.target.value)} placeholder="np. płatność 14 dni" />
      </Field>
    </Modal>
  );
}
